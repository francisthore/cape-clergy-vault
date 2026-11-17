# shellcheck shell=sh disable=SC2034,SC2013
# TEMPORARY HOST PROBE helpers. Source as root:  . /run/cape-probe/bin/helpers.sh
# Read-only except probe_guard, which may SIGKILL one cape-probe-* unit. Prints no secrets.
P=/run/cape-probe
S=/sys/fs/cgroup/cape.slice/cape-probe.slice # 'cape-probe.slice' nests under an implicit cape.slice
jl() { journalctl -u "$1.service" -o cat --no-pager --since "${T0:-5 min ago}"; } # unit journal since $T0
probe_run() { # probe_run UNIT: start, wait (max 60 s) until it exits, print its journal and result
  T0=$(date '+%F %T'); systemctl start "$1.service"; i=0
  while systemctl is-active --quiet "$1.service" && [ "$i" -lt 120 ]; do sleep 0.5; i=$((i + 1)); done
  sleep 1; jl "$1"; systemctl show -p Result,ExecMainStatus "$1.service"
}
probe_start() { # probe_start UNIT: start a long-running mode and wait for its 'ready' line (max 20 s)
  T0=$(date '+%F %T'); systemctl start "$1.service"; i=0
  until jl "$1" | grep -q '^ready'; do sleep 0.5; i=$((i + 1)); [ "$i" -lt 40 ] || { echo "NOT READY"; return 1; }; done
  jl "$1"
}
probe_cg() { echo "$S/$1.service"; }
probe_pids() { # probe_pids UNIT: MainPID plus the host pid of every process in the unit's cgroup
  echo "unit=$1 MainPID=$(systemctl show -p MainPID --value "$1.service")"
  for p in $(cat "$(probe_cg "$1")/cgroup.procs"); do
    awk -v p="$p" '/^NSpid:/ { print "host_pid=" p " NSpid=" $2 (NF > 2 ? "/" $3 : "") }' "/proc/$p/status"
  done
}
probe_snapshot() { # NEIGHBOUR_UNITS="a.service b.service" optional
  date -u +%FT%TZ
  awk '/^(MemTotal|MemAvailable|SwapTotal|SwapFree):/ { printf "%s%s ", $1, $2 } END { print "" }' /proc/meminfo
  echo "loadavg=$(cut -d' ' -f1-3 /proc/loadavg)"
  for r in cpu memory io; do echo "psi_$r=$(head -1 "/proc/pressure/$r" 2>/dev/null)"; done
  echo "failed_units=$(systemctl --failed --no-legend --plain | wc -l)"
  echo "listeners=$(ss -H -ltn | awk '{print $4}' | sort | tr '\n' ' ')"
  echo "mounts_sha=$(findmnt -rno TARGET,FSTYPE | sort | sha256sum | cut -c1-16)"
  echo "mntns=$(lsns -n -t mnt | wc -l) pidns=$(lsns -n -t pid | wc -l) unshare_procs=$(pgrep -cx unshare)"
  for u in ${NEIGHBOUR_UNITS:-}; do
    echo "unit=$u active=$(systemctl is-active "$u") nrestarts=$(systemctl show -p NRestarts --value "$u") mainpid=$(systemctl show -p MainPID --value "$u")"
  done
}
probe_latency() { # probe_latency URL [N]: loopback health URL nominated by the owner
  for _ in $(seq "${2:-10}"); do curl -s -o /dev/null -m 5 -w '%{time_total}\n' "$1"; done |
    sort -n | awk '{ a[NR] = $1 } END { printf "n=%d p50=%s max=%s\n", NR, a[int((NR + 1) / 2)], a[NR] }'
}
probe_events() { # probe_events UNIT: cgroup limits, events and usage for the probe unit
  c=$(probe_cg "$1")
  for f in memory.current memory.high memory.max memory.swap.max memory.events cpu.max cpu.stat pids.current pids.max pids.events; do
    echo "--- $f"
    cat "$c/$f" 2>&1
  done
}
probe_guard() { # probe_guard UNIT (run in background): kills ONLY that unit if the host gets tight
  case "$1" in cape-probe-*) ;; *) echo "guard: refuse non-probe unit" >&2; return 2 ;; esac
  i=0; until systemctl is-active --quiet "$1.service" || [ "$i" -ge 100 ]; do sleep 0.1; i=$((i + 1)); done
  swap0=$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)
  while systemctl is-active --quiet "$1.service"; do
    ma=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
    sf=$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)
    if [ "$ma" -lt "${GUARD_MIN_AVAIL_KB:-1200000}" ] || [ $((swap0 - sf)) -gt "${GUARD_MAX_SWAP_KB:-51200}" ]; then
      echo "GUARD ABORT: MemAvailable=${ma}kB swap_used_delta=$((swap0 - sf))kB"
      systemctl kill --kill-whom=all -s SIGKILL "$1.service"
      return 1
    fi
    sleep 0.5
  done
  echo "guard: unit ended, no abort"
}
probe_watch() { # probe_watch UNIT FILE...: wait for the unit's cgroup, print the last readable values before it vanishes
  c=$(probe_cg "$1"); shift
  until [ -d "$c" ]; do sleep 0.1; done
  last=""
  while [ -d "$c" ]; do
    cur=$(for f in "$@"; do echo "--- $f"; cat "$c/$f" 2>/dev/null; done)
    case "$cur" in *[0-9]*) last=$cur ;; esac
    sleep 0.2
  done
  printf '%s\n' "$last"
}
