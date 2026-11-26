#!/bin/sh
# Workstation-only. Run a copy with private fixtures; no unit or mount operations.
set -eu
d=$(mktemp -d)
trap 'rm -rf -- "$d"' EXIT
mkdir -p "$d/ctl" "$d/secrets" "$d/decoy" "$d/own" "$d/bin"
printf '%s\n' 'synthetic-secret-must-stay-private' > "$d/secrets/probe-secret"
cp "$d/secrets/probe-secret" "$d/decoy/probe"
sed -e "s|^P=/run/cape-probe$|P=$d|" \
  -e "s|/run/credentials/cape-probe-decoy.service|$d/decoy|g" \
  ops/host-probe/stage1.sh > "$d/reporter"
run() {
  CREDENTIALS_DIRECTORY="$d/own" PROBE_MODE="$1" sh "$d/reporter" > "$d/log" 2>&1
}
reject() {
  if run "$1"; then echo "C1 unexpectedly passed ($1)" >&2; exit 1; fi
}
run plus
grep -Fxq 'write_ctl: OK' "$d/log"
test ! -e "$d/ctl/stage1-write-test"
if grep -q 'synthetic-secret-must-stay-private' "$d/log"; then exit 1; fi

# A marker collision must fail even for the control, preserving existing data.
echo 'sentinel' > "$d/ctl/stage1-write-test"
reject plus
grep -Fq 'write_ctl: invalid test (' "$d/log"
test "$(cat "$d/ctl/stage1-write-test")" = sentinel
rm "$d/ctl/stage1-write-test"
mv "$d/secrets" "$d/hidden-source"
mv "$d/decoy" "$d/hidden-decoy"
reject bang
grep -Fxq 'write_ctl: OK' "$d/log"

# Simulate GNU mkdir's C-locale errors and per-mount flags without mounts.
cat > "$d/bin/mkdir" <<'SH'
#!/bin/sh
printf 'mkdir: cannot create directory %s: %s\n' "$4" "$C1_ERROR" >&2
exit 1
SH
cat > "$d/bin/findmnt" <<'SH'
#!/bin/sh
printf '/run tmpfs %s,nosuid,nodev,noexec\n' "$C1_MOUNT"
SH
chmod 0755 "$d/bin/findmnt" "$d/bin/mkdir"
export PATH="$d/bin:$PATH"
export C1_ERROR='Read-only file system' C1_MOUNT=ro
run bang || { cat "$d/log" >&2; exit 1; }
grep -Fxq 'write_ctl: FAIL (EROFS)' "$d/log"
C1_ERROR='Permission denied' reject bang
grep -Fq 'write_ctl: invalid test (' "$d/log"
C1_MOUNT=rw reject bang
mv "$d/hidden-source" "$d/secrets"
reject bang
grep -Fxq 'read_secret: OK' "$d/log"
