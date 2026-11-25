#!/bin/sh
# shellcheck disable=SC2016
# Quoted patterns below match literal shell source in the production launcher.
# Workstation only. --render-launcher emits the reviewed G1 artifact on stdout.
set -eu
export LC_ALL=C
cd "$(dirname "$0")/../.."
template=ops/libexec/cape-vault-ns-launch.example
render_launcher() {
  sed -e 's#^NODE=.*#NODE=/opt/cape-probe-exec/payload.sh#' \
    -e 's#^    -- "\$NODE" scripts/service-entry.mjs "\$kind"$#    -- "$NODE" "$kind"#' "$template"
}
case "$#:${1:-}" in
  1:--render-launcher) render_launcher; exit 0 ;;
  0:) ;;
  *) echo 'Usage: check-local.sh [--render-launcher]' >&2; exit 2 ;;
esac
fail() { echo "FAIL: $*" >&2; exit 1; }
d=$(mktemp -d)
trap 'rm -rf -- "$d"' EXIT
mkdir "$d/bin" "$d/units"
launch=$d/bin/launch
render_launcher > "$launch"
echo '1. ShellCheck and shell syntax'
shellcheck -s sh ops/host-probe/*.sh "$template" "$launch"
for script in ops/host-probe/*.sh "$template" "$launch"; do sh -n "$script"; done

echo '2. Only the runtime and entry point change in the launcher'
# Check both sides of the diff, including removals, and the executable stage-two path.
if diff "$template" "$launch" > "$d/changes"; then fail 'launcher identical'; else test "$?" = 1; fi
cat "$d/changes"
test "$(grep -c '^< ' "$d/changes")" = 2
test "$(grep -c '^> ' "$d/changes")" = 2
grep -Fxq 'NODE=/opt/cape-probe-exec/payload.sh' "$launch"
grep -Fxq '    -- "$NODE" "$kind"' "$launch"
grep -Fxq '  "$0" --stage2 "$svc_user" "$kind"' "$launch"

echo '3. Execution paths, privilege prefixes and sandbox settings'
keys='NoNewPrivileges|CapabilityBoundingSet|AmbientCapabilities|RestrictNamespaces|PrivateMounts|PrivateTmp|PrivateDevices|ProtectSystem|ProtectHome|ProtectProc|ProcSubset|ProtectKernelTunables|ProtectKernelModules|ProtectKernelLogs|ProtectControlGroups|RestrictSUIDSGID|RestrictRealtime|LockPersonality|RestrictAddressFamilies|UMask|KillMode|OOMScoreAdjust|MemorySwapMax|CPUWeight|LimitNOFILE|LimitCORE'
# The operator's migration/rollback inventory names the old files; runtime code must not.
if grep -nE '(/run/cape-probe|\$P|\$\{P\})/bin/|/run/[^[:space:]"]*/(payload\.sh|stage1\.sh|launch)([[:space:]"]|$)' \
  ops/host-probe/payload.sh ops/host-probe/stage1.sh ops/host-probe/helpers.sh "$launch" ops/host-probe/units/*; then
  fail 'stale probe executable under /run'
fi
ref=$(grep -E "^($keys)=" ops/systemd/cape-vault-web.service.example | sort)
# Guard the graceful-stop fix independently of probe/production parity.
for u in ops/systemd/cape-vault-{web,scanner,approval,reviewer}.service.example; do
  test "$(grep -c '^KillMode=' "$u")" = 1 || fail "$u KillMode count"
  grep -Fxq 'KillMode=control-group' "$u" || fail "$u must signal namespace PID 1"
done
# N8b must outlive TERM even if its sleep child receives TERM too.
grep -Fq "trap '' TERM" ops/host-probe/payload.sh || fail 'N8b TERM ignore missing'
grep -Fq '    sleep 5 || :' ops/host-probe/payload.sh || fail 'N8b persistence loop missing'
for u in ops/host-probe/units/*.service; do
  name=${u##*/}
  case "$name" in
    cape-probe-launch@.service|cape-probe-launch-ro@.service|cape-probe-launch-none@.service)
      command='!/opt/cape-probe-exec/launch 65534 web' ;;
    cape-probe-direct@.service) command='/opt/cape-probe-exec/payload.sh' ;;
    cape-probe-bang.service) command='!/opt/cape-probe-exec/stage1.sh' ;;
    cape-probe-plus.service) command='+/opt/cape-probe-exec/stage1.sh' ;;
    cape-probe-decoy.service) command='/usr/bin/sleep 3600' ;;
    *) fail "unexpected unit $name" ;;
  esac
  # Also rejects new ExecStartPre/Post, ExecCondition or interpreter indirection.
  test "$(grep -E '^[[:space:]]*Exec[A-Za-z]+[[:space:]]*=' "$u")" = "ExecStart=$command" || fail "$name execution path"
  got=$(grep -E "^($keys)=" "$u" | sort)
  case "$name" in
    *-bang.service|*-plus.service) expected=$(printf '%s\n' "$ref" | grep -v '^KillMode=') ;;
    *-decoy.service) continue ;; # Deliberately minimal sibling, original sleep command checked above.
    *) expected=$ref ;;
  esac
  test "$got" = "$expected" || fail "$name sandbox differs from production"
done

echo '4. Offline systemd unit verification with executable fixtures'
install -m 0755 ops/host-probe/payload.sh ops/host-probe/stage1.sh "$d/bin/"
chmod 0755 "$launch"
# Replace only the checked executable prefix. Data paths and sandbox stay verbatim.
for u in ops/host-probe/units/*.service; do
  sed "/^ExecStart=/s|/opt/cape-probe-exec/|$d/bin/|" "$u" > "$d/units/${u##*/}"
done
cp ops/host-probe/units/cape-probe.slice "$d/units/"
set -- "$d"/units/*
test "$#" = 8 || fail 'expected seven services and one slice'
if ! SYSTEMD_UNIT_PATH="$d/units:/usr/lib/systemd/system" systemd-analyze verify --man=no "$@" > "$d/verify" 2>&1; then
  cat "$d/verify" >&2; fail 'systemd-analyze verify'
fi
cat "$d/verify"
# systemd can ignore an unknown key and still return success.
if grep -Ev '/cape-probe-[^:]+\.service:[0-9]+: Special user nobody configured, this is not safe!$' "$d/verify"; then
  fail 'unexpected probe unit diagnostic'
fi
echo 'ALL LOCAL CHECKS PASSED'
