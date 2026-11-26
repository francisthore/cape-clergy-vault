#!/bin/bash
# Workstation only. Verify the delivered unit files with disposable executables.
set -euo pipefail
export LC_ALL=C
here=ops/host-probe/c1
d=$(mktemp -d)
trap 'rm -rf -- "$d"' EXIT
shellcheck "$here"/*.sh
for f in "$here"/*.sh; do bash -n "$f"; done
sh -n "$here/runtime.sh"
python3 -B "$here/test_assess.py"
python3 -B "$here/test_reporter.py"
python3 -B "$here/test_inventory.py"
python3 -B "$here/test_pending.py"
for n in 1 2; do
  bash "$here/package.sh" "$d/b$n"
  (cd "$d/b$n" && sha256sum --check --strict SHA256SUMS)
done
diff -r "$d/b1" "$d/b2"
# Run the real reporters from the exact packaged bytes through the assessor.
C1_BUNDLE="$d/b1" python3 -B "$here/test_reporter.py"
mkdir "$d/verify" "$d/bin"
for f in runtime.sh stage1.sh; do install -m 0755 "$d/b1/$f" "$d/bin/$f"; done
for u in "$d/b1"/*.service; do
  sed "/^ExecStart=/s|/opt/cape-probe-exec/|$d/bin/|" "$u" > "$d/verify/${u##*/}"
done
for role in scanner approval reviewer; do
  u=$d/b1/cape-probe-runtime-$role.service
  prod=ops/systemd/cape-vault-$role.service.example
  grep -Fxq "RuntimeDirectory=cape-vault/$role" "$prod"
  grep -Fxq "RuntimeDirectory=cape-probe/$role" "$u"
  grep -Fxq "ReadWritePaths=/run/cape-vault/$role" "$prod"
  [[ $(grep '^ReadWritePaths=' "$u") == "ReadWritePaths=/run/cape-probe/$role" ]]
  grep -Fxq 'ReadOnlyPaths=/run' "$u"
  grep -Fxq "ExecStart=/opt/cape-probe-exec/runtime.sh $role" "$u"
done
cp "$d/b1/cape-probe.slice" "$d/verify/"
verify_rc=0
SYSTEMD_UNIT_PATH="$d/verify:/usr/lib/systemd/system" systemd-analyze verify --man=no "$d/verify/"* > "$d/verify.log" 2>&1 || verify_rc=$?
cat "$d/verify.log"
((verify_rc == 0))
awk '!/\/cape-probe-[^:]+\.service:[0-9]+: Special user nobody configured, this is not safe!$/ {bad=1} END {exit bad}' "$d/verify.log"

# Exercise the same receipt-based file rollback that the operator runs, under
# a private temporary tree. Simulate a setup interrupted after one file copy.
e=$d/evidence p=$d/probe x=$d/exec dest=$d/system
mkdir "$e" "$p" "$x" "$dest"
cp "$d/b1/stage1.sh" "$x/stage1.sh"
for path in "$p" "$x" "$x/stage1.sh"; do
  printf '%s %s\n' "$(stat -c '%d:%i' "$path")" "$path" >> "$e/created"
done
undo() { (cd "$d/b1" && bash rollback-files.sh "$e" "$p" "$x" "$dest"); }
echo keep > "$p/unknown"
mv "$x/stage1.sh" "$d/original"
cp "$d/original" "$x/stage1.sh"
if undo > "$d/refusal" 2>&1; then exit 1; fi
test -f "$x/stage1.sh"
mv "$d/original" "$x/stage1.sh"
if undo > "$d/refusal" 2>&1; then exit 1; fi
test "$(cat "$p/unknown")" = keep
test ! -e "$x"
rm "$p/unknown"
undo
undo
test ! -e "$p"

# Test the real phase dispatcher with inert phase bodies. A test failure and
# a rollback failure both remain visible, and a failed bang skips later tests.
cat > "$d/dispatch.sh" <<'MOCK'
set -euo pipefail
E=$1 action=run C1_SHA256=fixture
absent() { [[ ! -e $1 ]]; }
trusted_dir() { [[ -d $1 ]]; }
die() { exit 1; }
setup() { echo setup >> "$E/steps"; }
probe() { echo "$phase" >> "$E/steps"; if [[ $phase == bang ]]; then return 73; fi; }
rollback() { echo rollback >> "$E/steps"; false; echo UNREACHABLE >> "$E/steps"; }
MOCK
sed -n '/^run_phase() (/,$p' "$d/b1/host.sh" >> "$d/dispatch.sh"
rc=0
bash "$d/dispatch.sh" "$d/dispatch-evidence" > "$d/dispatch.log" || rc=$?
[[ $rc == 1 ]]
grep -Fxq 'workflow_rc=73 rollback_rc=1' "$d/dispatch-evidence/result"
[[ $(cat "$d/dispatch-evidence/steps") == $'setup\nbang\nrollback' ]]
echo 'C1 offline verification, verdict and rollback fixtures passed'
