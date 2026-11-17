#!/bin/sh
# Local (workstation) consistency checks for the temporary host probe. Touches nothing on any host.
# Usage: sh ops/host-probe/check-local.sh   (from the repository root)
set -eu
cd "$(dirname "$0")/../.."
fail=0
note() { printf '%s\n' "$*"; }

note "1. shellcheck"
shellcheck -s sh ops/host-probe/payload.sh ops/host-probe/stage1.sh ops/host-probe/helpers.sh ops/libexec/cape-vault-ns-launch.example || fail=1

note "2. probe launcher derivation: exactly two changed lines"
tmp=$(mktemp)
sed -e 's#^NODE=.*#NODE=/run/cape-probe/bin/payload.sh#' \
  -e 's#"\$NODE" scripts/service-entry.mjs "\$kind"#"$NODE" "$kind"#' \
  ops/libexec/cape-vault-ns-launch.example >"$tmp"
changed=$(diff ops/libexec/cape-vault-ns-launch.example "$tmp" | grep -c '^>' || true)
[ "$changed" = 2 ] || { note "FAIL: expected 2 changed lines, got $changed"; fail=1; }
diff ops/libexec/cape-vault-ns-launch.example "$tmp" || true
sh -n "$tmp" && rm -f "$tmp"

note "3. sandbox directives identical to the real web unit"
keys='NoNewPrivileges|CapabilityBoundingSet|AmbientCapabilities|RestrictNamespaces|PrivateMounts|PrivateTmp|PrivateDevices|ProtectSystem|ProtectHome|ProtectProc|ProcSubset|ProtectKernelTunables|ProtectKernelModules|ProtectKernelLogs|ProtectControlGroups|RestrictSUIDSGID|RestrictRealtime|LockPersonality|RestrictAddressFamilies|UMask|KillMode|OOMScoreAdjust|MemorySwapMax|CPUWeight|LimitNOFILE|LimitCORE'
ref=$(grep -E "^($keys)=" ops/systemd/cape-vault-web.service.example | sort)
for u in ops/host-probe/units/cape-probe-launch*.service ops/host-probe/units/cape-probe-direct@.service ops/host-probe/units/cape-probe-bang.service ops/host-probe/units/cape-probe-plus.service; do
  got=$(grep -E "^($keys)=" "$u" | sort)
  # oneshot readers carry fewer keys: every key they carry must equal production
  bad=$(printf '%s\n' "$got" | while IFS= read -r l; do printf '%s\n' "$ref" | grep -qxF -- "$l" || echo "$l"; done)
  [ -z "$bad" ] || { note "FAIL $u differs from production: $bad"; fail=1; }
done

note "4. systemd-analyze: unknown directives only (missing /run files are expected)"
d=$(mktemp -d)
cp ops/host-probe/units/* "$d"/
for u in "$d"/*.service "$d"/cape-probe.slice; do
  out=$(systemd-analyze verify --man=no "$u" 2>&1 || true)
  # only lines about our files: unrelated host units may warn on this workstation's systemd
  if printf '%s\n' "$out" | grep -F "$d" | grep -iE 'unknown (key|section|lvalue)|invalid|bad (value|unit)'; then fail=1; fi
done
rm -rf "$d"
[ "$fail" = 0 ] && note "ALL LOCAL CHECKS PASSED" || { note "LOCAL CHECKS FAILED"; exit 1; }
