#!/bin/sh
# shellcheck disable=SC2012,SC2016
# TEMPORARY HOST PROBE payload (Phase 5A rev 3). Install only as /run/cape-probe/bin/payload.sh.
# Synthetic output only. Reads nothing outside the probe tree and the kernel's own /proc view of
# itself. Writes only where a mode says so. The mode is the unit instance name (PROBE_MODE).
set -u
umask 077
# Snapshot /proc BEFORE any child exists (shell glob: no fork), so the list is the true start state.
set -- /proc/[0-9]*
proc_at_start=$*
P=/run/cape-probe
mode=${PROBE_MODE:-report}
errf=/tmp/probe.err.$$
say() { printf '%s\n' "$*"; }
try() { # try NAME CMD...: prints OK or the first 160 bytes of the error text
  name=$1
  shift
  if "$@" >/dev/null 2>"$errf"; then say "$name: OK"; else say "$name: FAIL: $(head -c 160 "$errf" | tr '\n' ' ')"; fi
}
report() {
  say "== report mode=$mode"
  say "pid=$$ uid=$(id -u) gid=$(id -g) groups=[$(id -G)]"
  grep -E '^(NSpid|CapInh|CapPrm|CapEff|CapBnd|CapAmb|NoNewPrivs|Seccomp):' "/proc/$$/status"
  say "proc_at_start=$proc_at_start"
  grep ' /proc ' "/proc/$$/mountinfo" | sed 's/^/proc_mount: /'
  say "proc_sys=$([ -e /proc/sys ] && echo present || echo absent)"
  say "ns_pid=$(readlink "/proc/$$/ns/pid") ns_mnt=$(readlink "/proc/$$/ns/mnt")"
  say "apparmor=$(cat "/proc/$$/attr/current" 2>&1)"
  say "oom_score_adj=$(cat "/proc/$$/oom_score_adj")"
  say "cred_dir=${CREDENTIALS_DIRECTORY:-unset}"
}
case "$mode" in
report)
  report
  ;;
hold) # N4 'victim': holds a synthetic marker in its environment
  report
  say "marker_len=${PROBE_MARKER:+${#PROBE_MARKER}}"
  trap 'say "TERM received"; exit 0' TERM
  say "ready"
  sleep 3600 &
  wait
  ;;
spy) # N4 'attacker': same UID, same slice; targets are HOST pids written by the operator
  report
  say "visible_pids_now=$(set -- /proc/[0-9]*; echo $#)"
  while read -r tpid; do
    case "$tpid" in '' | *[!0-9]*) continue ;; esac
    say "-- target host pid $tpid"
    n=$(grep -ac 'SYNTHETIC-PROBE-' "/proc/$tpid/environ" 2>"$errf")
    say "environ_marker_hits=$n err=$(head -c 120 "$errf" | tr '\n' ' ')"
    try root_ls ls "/proc/$tpid/root/"
    try cwd_ls ls "/proc/$tpid/cwd/"
    try cred_ls ls "/proc/$tpid/root/run/credentials/"
    try mem_read head -c 16 "/proc/$tpid/mem"
    try kill0 kill -0 "$tpid"
  done <"$P/ctl/spy.targets"
  ;;
escalate) # N3: every line must say FAIL
  report
  try unshare_pid /usr/bin/unshare --pid true
  try unshare_mnt /usr/bin/unshare --mount true
  try unshare_net /usr/bin/unshare --net true
  try mount_tmpfs /usr/bin/mount -t tmpfs x /mnt
  try setuid_root /usr/bin/setpriv --reuid=0 true
  try raise_inh_cap /usr/bin/setpriv --inh-caps=+sys_admin true
  try raise_amb_cap /usr/bin/setpriv --inh-caps=+net_raw --ambient-caps=+net_raw true
  ;;
creds) # C2 and decoy credential isolation
  report
  if [ -n "${CREDENTIALS_DIRECTORY:-}" ]; then
    ls -lnA "$CREDENTIALS_DIRECTORY"
    stat -c '%n mode=%a uid=%u type=%F' "$CREDENTIALS_DIRECTORY"/*
  fi
  say "-- /run/credentials as seen here"
  ls -ln /run/credentials 2>&1
  try own_cred_read cat "${CREDENTIALS_DIRECTORY:-/nonexistent}/probe"
  try decoy_dir_ls ls /run/credentials/cape-probe-decoy.service
  try decoy_cred_read cat /run/credentials/cape-probe-decoy.service/probe
  try secrets_dir_ls ls "$P/secrets"
  try secrets_file_read cat "$P/secrets/probe-secret"
  ;;
fs) # S1-S3: works for rw, ro, none and direct variants
  report
  O=$P/objects
  say "objects_mount=$(grep " $O " "/proc/$$/mountinfo" | head -n1)"
  try ls_dir ls -ln "$O"
  try read_seed cat "$O/seed.txt"
  d="$O/t-$$"
  try mkdir mkdir -m 0700 "$d"
  try create_file sh -c ": > '$d/f' && chmod 0600 '$d/f'"
  [ -d "$d" ] && stat -c 'created %n mode=%a uid=%u' "$d" "$d/f"
  try fsync sh -c "echo synthetic > '$d/f2' && sync '$d/f2'"
  try rename mv "$d/f" "$d/g"
  try unlink sh -c "rm -f '$d/g' '$d/f2' && rmdir '$d'"
  try touch_seed touch "$O/seed.txt"
  try chmod_seed chmod 0600 "$O/seed.txt"
  try truncate_seed truncate -s +0 "$O/seed.txt"
  try mkdir_again mkdir "$O/t2-$$"
  [ -d "$O/t2-$$" ] && rmdir "$O/t2-$$"
  try write_etc sh -c ": > /etc/cape-probe-should-fail"
  try write_usr sh -c ": > /usr/cape-probe-should-fail"
  try write_run_ctl sh -c ": > $P/ctl/cape-probe-should-fail"
  try write_tmp sh -c ": > /tmp/cape-probe-private-tmp"
  say "home_entries=$(ls -A /home 2>&1 | wc -l)"
  ;;
term-slow) # N8: traps TERM, drains for 20 s, exits 0
  report
  trap 'say "TERM received $(date +%s.%N)"; sleep 20; say "drain complete $(date +%s.%N)"; exit 0' TERM
  say "ready $(date +%s.%N)"
  sleep 600 &
  wait
  ;;
term-ignore) # N8 negative control: no handler, so a namespace init ignores a forwarded SIGTERM
  report
  say "ready $(date +%s.%N)"
  sleep 600 &
  wait
  ;;
mem) # M2: allocates until the cgroup limit; run only with the guard
  report
  say "mem start $(date +%s.%N)"
  tail /dev/zero
  say "tail exit=$?"
  ;;
cpu) # M3: single busy loop for 30 s
  report
  say "cpu start $(date +%s.%N)"
  timeout 30 sh -c 'while :; do :; done'
  say "cpu end $(date +%s.%N) rc=$?"
  ;;
pids) # M4: forks until the pids limit refuses (perl-base is always installed on Ubuntu)
  report
  perl -e '
    my ($ok, $fail, $first) = (0, 0, 0);
    for my $i (1 .. 120) {
      my $pid = fork();
      if (!defined $pid) { $fail++; $first ||= $i; last if $fail >= 3; next }
      if ($pid == 0) { sleep 120; exit 0 }
      $ok++;
    }
    print "forks_ok=$ok first_fail_at=$first err=$!\n";
    sleep 4;
  '
  ;;
execve) # N7: process.execve under the host Node (pinned Node 24 is tested after install)
  report
  NODE=$(cat "$P/ctl/node.path")
  "$NODE" -e '
    console.log("node", process.version, "pid", process.pid, "execve", typeof process.execve);
    if (typeof process.execve !== "function") process.exit(3);
    process.execve("/bin/sh", ["sh", "-c", "echo after-execve pid=$$ uid=$(id -u)"], {});
  '
  ;;
*)
  say "unknown mode $mode"
  exit 64
  ;;
esac
rm -f "$errf"
