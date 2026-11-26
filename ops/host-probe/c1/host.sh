#!/bin/bash
# Reviewed bundle entry point. Invoke manually in an approved host window.
set -euo pipefail
set +x
export LC_ALL=C PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077
die() { echo "STOP: $*" >&2; exit 1; }
absent() { [[ ! -e $1 && ! -L $1 ]]; }
trusted_dir() {
  [[ $(realpath -e -- "$1") == "$1" && -d $1 && $(stat -c %u "$1") == 0 ]]
  [[ -z $(find "$1" -maxdepth 0 -perm /022 -print) ]]
}
B=$(cd -- "$(dirname -- "$0")" && pwd -P)
case_dir=${B%/*}
E=$case_dir/evidence
P=/run/cape-probe
X=/opt/cape-probe-exec
D=/run/systemd/system
cg=/sys/fs/cgroup/cape.slice
units=(cape-probe-bang.service cape-probe-plus.service cape-probe-decoy.service cape-probe-runtime-{scanner,approval,reviewer}.service cape-probe.slice)
cases=(cape-probe-decoy.service cape-probe-bang.service cape-probe-runtime-scanner.service cape-probe-runtime-approval.service cape-probe-runtime-reviewer.service cape-probe-plus.service)
action=${1:-}
case $action in run|rollback) ;; *) die 'expected run or rollback';; esac
[[ $EUID == 0 && $B == /root/cape-c1-*/bundle && ${case_dir%/*} == /root ]] || die 'case path or UID'
for dir in /root "$case_dir" "$B" /run /run/systemd "$D" /opt; do trusted_dir "$dir"; done
cd "$B"
for f in SHA256SUMS host.sh rollback-files.sh assess.py stage1.sh runtime.sh "${units[@]}"; do
  [[ -f $f && ! -L $f && $(stat -c '%u:%g:%h' "$f") == 0:0:1 ]]
  [[ -z $(find "$f" -maxdepth 0 -perm /022 -print) ]]
done
[[ ${C1_SHA256:-} =~ ^[a-f0-9]{64}$ ]]
printf '%s  SHA256SUMS\n' "$C1_SHA256" | sha256sum --check --strict --status
sha256sum --check --strict --status SHA256SUMS
# Serialise commands within the case without creating a host lock file.
exec 9<"$case_dir"
flock -n 9 || die 'another command is running'

record() { printf '%s %s\n' "$(stat -c '%d:%i' -- "$1")" "$1" >> "$E/created"; }
created_dir() { mkdir -m "$2" -- "$1"; record "$1"; }
created_file() {
  local dest=$1 mode=$2
  absent "$dest" || die "collision $dest"
  (set -C; : > "$dest")
  record "$dest"
  cat > "$dest"
  chmod "$mode" "$dest"
}
snapshot() {
  local u state
  while IFS= read -r u; do
    state=$(systemctl show "$u" -p LoadState -p ActiveState -p MainPID -p NRestarts)
    grep -qx 'LoadState=loaded' <<< "$state" || die "missing neighbour $u"
    grep -qx 'ActiveState=active' <<< "$state" || die "inactive neighbour $u"
    grep -Eq '^MainPID=[1-9][0-9]*$' <<< "$state" || die "neighbour PID $u"
    printf '%s\n%s\n' "$u" "$state"
  done < "$E/neighbours"
  ss -H -ltn | awk '{print $4}' | sort
  # PID 1 may mount the synthetic credential directories on the host. Only
  # these exact targets may differ during tests; compare all mounts at cleanup.
  findmnt -rn -o TARGET,FSTYPE |
    awk -v phase="$phase" -v names="${cases[*]}" 'BEGIN {n=split(names,a," "); for(i=1;i<=n;i++) own["/run/credentials/"a[i]]=1}
      phase=="setup" || phase=="rollback" || !($1 in own)' | sort | sha256sum
  systemctl --failed --no-legend --plain | awk '$1 !~ /^cape-probe-/ {print $1}' | sort
}
compare_neighbours() {
  local now
  now=$(mktemp "$E/snapshot.XXXXXX")
  snapshot > "$now"
  diff -u "$E/before" "$now"
}
headroom() {
  (( $(date +%s) - $(cat "$E/start-time") < 7200 ))
  awk '$1=="MemAvailable:" {ok=$2>=1572864} END {exit !ok}' /proc/meminfo
  awk '$1=="some" {for(i=2;i<=NF;i++) if($i~/^avg60=/) ok=substr($i,7)+0<5} END {exit !ok}' /proc/pressure/memory
  vmstat 1 5 | awk '$1~/^[0-9]+$/ {if(n++ && ($7 || $8)) busy=1} END {exit (n!=5 || busy)}'
}
pending() {
  # Include all loaded unit types. Ignore only our attested unit files on rollback.
  local list u flag
  list=$(systemctl list-units --all --plain --no-legend --no-pager | awk '{print $1}')
  while IFS= read -r u; do
    [[ -n $u ]] || continue
    flag=$(systemctl show -p NeedDaemonReload --value "$u")
    if [[ $flag != no ]]; then
      if [[ $phase == rollback && $flag == yes ]]; then
        case " ${cases[*]} ${units[*]} " in *" $u "*) continue ;; esac
      fi
      die "pending edit or unknown reload state $u"
    fi
  done <<< "$list"
}
installed() {
  local src dest mode
  for dir in "$P" "$P/ctl" "$P/secrets" "$X"; do
    trusted_dir "$dir"
    mode=755
    if [[ $dir == "$P/secrets" ]]; then mode=700; fi
    [[ $(stat -c '%u:%g:%a' "$dir") == "0:0:$mode" ]]
  done
  for name in probe-secret probe-secret-decoy; do
    [[ $(realpath -e "$P/secrets/$name") == "$P/secrets/$name" ]]
    [[ $(stat -c '%F:%u:%g:%a' "$P/secrets/$name") == 'regular file:0:0:600' ]]
    cmp -s "$P/secrets/$name" - <<< "C1 synthetic $name"
  done
  for src in "${units[@]}" runtime.sh stage1.sh; do
    case $src in *.sh) dest=$X/$src; mode=755 ;; *) dest=$D/$src; mode=644 ;; esac
    [[ $(realpath -e "$dest") == "$dest" && $(stat -c '%F:%u:%g:%a' "$dest") == "regular file:0:0:$mode" ]]
    cmp -- "$src" "$dest"
    sha256sum -- "$dest"
  done
}
loaded() {
  [[ $(systemctl show -p FragmentPath --value "$1") == "$D/$1" ]]
  [[ -z $(systemctl show -p DropInPaths --value "$1") ]]
  [[ $(systemctl show -p NeedDaemonReload --value "$1") == no ]]
}
start_case() {
  local unit=$1 rc=0
  headroom
  if [[ $unit != cape-probe-decoy.service ]]; then decoy_live; fi
  loaded "$unit"
  [[ $(systemctl show -p ActiveState --value "$unit") == inactive ]]
  touch "$E/start-$unit"
  systemctl start "$unit" || rc=$?
  printf '%s start_rc=%s\n' "$unit" "$rc"
  systemctl show "$unit" -p InvocationID -p ActiveState -p SubState -p MainPID \
    -p Result -p ExecMainStatus -p ExecMainCode > "$E/$unit.status"
  cat "$E/$unit.status"
  start_rc=$rc
}
decoy_live() {
  local current
  current=$(systemctl show cape-probe-decoy.service -p MainPID -p InvocationID -p SubState)
  [[ $current == "$(cat "$E/decoy.identity")" ]]
  grep -Eq '^InvocationID=[a-f0-9]{32}$' <<< "$current"
  grep -Fxq 'SubState=running' <<< "$current"
  grep -Eq '^MainPID=[1-9][0-9]*$' <<< "$current"
}
collect() {
  local u=$1 id journal
  id=$(sed -n 's/^InvocationID=//p' "$E/$u.status")
  [[ $id =~ ^[a-f0-9]{32}$ && $id != 00000000000000000000000000000000 ]] || die "$u has no attributable invocation"
  journal=$E/$u.log
  local bound
  bound=$(awk '$1=="CapBnd:" {print $2}' /proc/1/status)
  journalctl -b --quiet --no-pager -o cat "_SYSTEMD_INVOCATION_ID=$id" "_SYSTEMD_UNIT=$u" _TRANSPORT=stdout |
    python3 -I "$B/assess.py" "$u" "$start_rc" "$hostns" "$bound" "$E/$u.status" "$journal"
}

setup() {
  [[ $(hostname -f) == vm400masc.kbsktrading.net ]]
  grep -Fxq 'ID=ubuntu' /etc/os-release
  grep -Fxq 'VERSION_ID="24.04"' /etc/os-release
  version=$(systemctl show -p Version --value)
  [[ $version =~ ^255([.~[:space:]-]|$) ]]
  echo "manager=$version"
  dpkg-query -W -f='package=${Version}\n' systemd
  systemd-analyze --version
  [[ $(id -u nobody) == 65534 && $(getent group nogroup | cut -d: -f3) == 65534 ]]
  ps -eo uid= | awk '$1==65534 {busy=1} END {exit busy}'
  for path in "$P" "$X" "$cg"; do absent "$path"; done
  files=$(systemctl list-unit-files --no-legend --plain 'cape*')
  live=$(systemctl list-units --all --no-legend --plain 'cape*')
  [[ -z $files && -z $live ]]
  paths=$(systemd-analyze unit-paths)
  while IFS= read -r dir; do
    for path in "$dir"/cape*; do absent "$path"; done
  done <<< "$paths"
  runflags=$(findmnt -rn -T /run -o VFS-OPTIONS)
  for flag in rw noexec nosuid nodev; do [[ ,$runflags, == *,"$flag",* ]]; done
  optflags=$(findmnt -rn -T /opt -o VFS-OPTIONS)
  [[ ,$optflags, == *,rw,* && ,$optflags, != *,noexec,* ]]
  read -ra neighbours <<< "${C1_NEIGHBOURS:?owner-nominated live systemd service names}"
  ((${#neighbours[@]} > 0))
  for u in "${neighbours[@]}"; do [[ $u =~ ^[a-zA-Z0-9_@.-]+\.service$ && $u != cape-* && $u != -* ]]; done
  printf '%s\n' "${neighbours[@]}" > "$E/neighbours"
  for u in "${cases[@]}"; do absent "/run/credentials/$u"; done
  snapshot > "$E/before"
  cat "$E/before"
  headroom
  pending
  touch "$E/baseline.ok"
  created_dir "$P" 0755
  created_dir "$P/ctl" 0755
  created_dir "$P/secrets" 0700
  for f in probe-secret probe-secret-decoy; do
    created_file "$P/secrets/$f" 0600 <<< "C1 synthetic $f"
  done
  created_dir "$X" 0755
  for f in runtime.sh stage1.sh; do created_file "$X/$f" 0755 < "$f"; done
  for f in "${units[@]}"; do created_file "$D/$f" 0644 < "$f"; done
  installed
  rc=0
  systemd-analyze verify --man=no "${units[@]/#/$D/}" > "$E/verify" 2>&1 || rc=$?
  echo "verify_rc=$rc"
  ((rc == 0))
  awk '!/\/cape-probe-[^:]+\.service:[0-9]+: Special user nobody configured, this is not safe!$/ {bad=1} END {exit bad}' "$E/verify"
  pending
  touch "$E/reload-intent"
  systemctl daemon-reload
  for u in "${cases[@]}" cape-probe.slice; do loaded "$u"; done
  compare_neighbours
  touch "$E/setup.ok"
}

rollback() {
  touch "$E/rollback.started"
  if [[ -f $E/rollback.ok ]]; then echo 'Rollback already completed'; exit; fi
  if [[ -f $E/reload-intent && ! -f $E/stopped ]]; then
    for u in "${cases[@]}"; do
      [[ -f $E/start-$u ]] || continue
      loaded "$u"
      cmp -- "$u" "$D/$u"
      systemctl stop "$u"
      state=$(systemctl show -p ActiveState --value "$u")
      if [[ $state == failed ]]; then systemctl reset-failed "$u"; else [[ $state == inactive ]]; fi
    done
    # The parent was absent at setup. Never stop a populated or shared parent.
    if [[ -d $cg ]]; then
      [[ -f $E/start-cape-probe-decoy.service ]] || die 'unattributed parent slice'
      grep -Fxq 'populated 0' "$cg/cgroup.events"
      children=$(find "$cg" -mindepth 1 -type d)
      while IFS= read -r child; do
        [[ -z $child || $child == "$cg/cape-probe.slice" ]] || die 'unexpected cgroup; reconcile'
      done <<< "$children"
      loaded cape-probe.slice
      [[ -z $(systemctl show -p FragmentPath --value cape.slice) && -z $(systemctl show -p DropInPaths --value cape.slice) ]]
      systemctl stop cape-probe.slice cape.slice
    fi
    absent "$cg"
    touch "$E/stopped"
  fi
  bash "$B/rollback-files.sh" "$E" "$P" "$X" "$D"
  if [[ -f $E/reload-intent && ! -f $E/reloaded-back ]]; then
    pending
    systemctl daemon-reload
    touch "$E/reloaded-back"
  fi
  if [[ -f $E/baseline.ok ]]; then
    for path in "$P" "$X" "$cg" "${units[@]/#/$D/}"; do absent "$path"; done
    files=$(systemctl list-unit-files --no-legend --plain 'cape*')
    live=$(systemctl list-units --all --no-legend --plain 'cape*')
    [[ -z $files && -z $live ]]
    for u in "${cases[@]}"; do absent "/run/credentials/$u"; done
    compare_neighbours
  fi
  touch "$E/rollback.ok"
}

probe() {
  [[ -f $E/setup.ok && ! -f $E/rollback.started ]]
  case $phase in
    bang) previous=setup ;;
    runtime) previous=bang ;;
    plus) previous=runtime ;;
  esac
  [[ -f $E/$previous.ok ]]
  (set -C; : > "$E/$phase.attempt") # once per install, including failures
  installed
  compare_neighbours
  hostns=$(readlink /proc/1/ns/mnt)
  echo "host_mnt_ns=$hostns"
  if [[ $phase == bang ]]; then
    start_case cape-probe-decoy.service
    ((start_rc == 0))
    systemctl show cape-probe-decoy.service -p MainPID -p InvocationID -p SubState > "$E/decoy.identity"
  fi
  decoy_live
  if [[ $phase == runtime ]]; then
    for role in scanner approval reviewer; do
      u=cape-probe-runtime-$role.service
      absent "$P/$role"
      start_case "$u"
      collect "$u"
      systemctl stop "$u"
      absent "$P/$role"
      compare_neighbours
    done
  else
    u=cape-probe-$phase.service
    start_case "$u"
    collect "$u"
    absent "$P/ctl/stage1-write-test"
  fi
  decoy_live
  compare_neighbours
  touch "$E/$phase.ok"
}

run_phase() (
  phase=$1
  if [[ $phase == setup ]]; then
    mkdir -m 0700 -- "$E"
    : > "$E/created"
    cat /proc/sys/kernel/random/boot_id > "$E/boot"
    date +%s > "$E/start-time"
    printf '%s\n' "$C1_SHA256" > "$E/digest"
  fi
  trusted_dir "$E"
  [[ $(cat "$E/digest") == "$C1_SHA256" && $(cat "$E/boot") == "$(cat /proc/sys/kernel/random/boot_id)" ]] || die 'bundle or boot changed; reconcile inventory manually'
  # Append a separate record even for a repeated, interrupted rollback.
  log=$(mktemp "$E/$phase.XXXXXX")
  echo "Evidence $log"
  exec >>"$log" 2>&1
  trap 'rc=$?; echo "phase=$phase rc=$rc"; if ((rc)); then echo STOP >&2; fi' EXIT
  date --utc --iso-8601=seconds
  case $phase in
    setup) setup ;;
    rollback) rollback ;;
    *) probe ;;
  esac
)

if [[ $action == rollback ]]; then run_phase rollback; exit; fi
absent "$E" || die 'case already has evidence'
cleanup() {
  local rc=$? rb=0
  trap - EXIT
  # Do not call a shell function as an if/OR condition: that would suppress
  # errexit throughout rollback. Keep the same case lock until it finishes.
  if [[ -d $E ]]; then
    set +e
    (set -e; run_phase rollback)
    rb=$?
    set -e
  fi
  printf 'workflow_rc=%s rollback_rc=%s\n' "$rc" "$rb"
  if [[ -f $E/boot ]]; then printf 'workflow_rc=%s rollback_rc=%s\n' "$rc" "$rb" >> "$E/result"; fi
  if ((rb != 0)); then exit "$rb"; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
run_phase setup
run_phase bang
run_phase runtime
run_phase plus
