#!/bin/sh
# Synthetic C1 reader. The paired units run the same reporter as root.
set -eu
export LC_ALL=C
P=/run/cape-probe
case ${PROBE_MODE:-} in
  bang) hidden=FAIL; ctl_access=ro ;;
  plus) hidden=OK; ctl_access=rw ;;
  *) exit 64 ;;
esac
result=0
check() {
  name=$1 expected=$2
  shift 2
  if "$@" >/dev/null 2>&1; then actual=OK; else actual=FAIL; fi
  printf '%s: %s\n' "$name" "$actual"
  if [ "$actual" != "$expected" ]; then result=1; fi
}
printf '== stage1 variant=%s uid=%s\n' "$PROBE_MODE" "$(id -u)"
grep -E '^(CapBnd|CapEff|CapPrm|CapAmb|NoNewPrivs|Seccomp):' "/proc/$$/status"
mnt_ns=$(readlink "/proc/$$/ns/mnt")
printf 'mnt_ns=%s\n' "$mnt_ns"
# Resolve the covering mount, including when ctl is an ordinary directory.
# Log only mountpoint, filesystem type and per-mount flags.
for path in / /run "$P/ctl"; do
  mount_view=$(findmnt -rn -T "$path" -o TARGET,FSTYPE,VFS-OPTIONS)
  printf 'mount[%s]=%s\n' "$path" "$mount_view"
  # Only the control directory needs to be writable for the plus control.
  if [ "$PROBE_MODE" = plus ] && [ "$path" != "$P/ctl" ]; then continue; fi
  case ",${mount_view##* }," in
    *,"$ctl_access",*) ;;
    *) result=1 ;;
  esac
done
check read_secret "$hidden" cat "$P/secrets/probe-secret"
check ls_secrets "$hidden" ls "$P/secrets"
check ls_decoy_creds "$hidden" ls /run/credentials/cape-probe-decoy.service
check read_decoy_cred "$hidden" cat /run/credentials/cape-probe-decoy.service/probe
check ls_own_creds OK ls "${CREDENTIALS_DIRECTORY:?missing credential directory}"

# An exclusive mkdir cannot truncate or follow a pre-existing marker. Only
# EROFS demonstrates the intended denial. Keep cleanup errors fatal too.
marker=$P/ctl/stage1-write-test
if error=$(mkdir -m 0700 -- "$marker" 2>&1); then
  printf 'write_ctl: OK\n'
  rmdir -- "$marker"
  [ "$PROBE_MODE" = plus ] || result=1
else
  case "$error" in
    *': Read-only file system')
      printf 'write_ctl: FAIL (EROFS)\n'
      [ "$PROBE_MODE" = bang ] || result=1 ;;
    *)
      printf 'write_ctl: invalid test (%s)\n' "$error"
      result=1 ;;
  esac
fi
exit "$result"
