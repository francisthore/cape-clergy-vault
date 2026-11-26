#!/bin/sh
# Dedicated oneshot, synthetic data. No launcher, application or database.
set -eu
export LC_ALL=C
case ${1:-} in scanner|approval|reviewer) ;; *) exit 64 ;; esac
role=$1
own=/run/cape-probe/$role
test "$RUNTIME_DIRECTORY" = "$own"
test "$(id -u):$(id -g)" = 65534:65534
test "$(stat -c '%u:%g:%a' "$own")" = 65534:65534:700
ns=$(readlink /proc/self/ns/mnt)
printf 'mnt_ns=%s\n' "$ns"
for path in /run /run/cape-probe/ctl "$own"; do
  flags=$(findmnt -rn -T "$path" -o TARGET,FSTYPE,VFS-OPTIONS)
  printf 'mount[%s]=%s\n' "$path" "$flags"
  access=ro
  if [ "$path" = "$own" ]; then access=rw; fi
  case ",${flags##* }," in *,"$access",*) ;; *) exit 1 ;; esac
done
# mkdir is exclusive. A pre-existing marker must survive.
mkdir -m 0700 -- "$own/c1-lock"
rmdir -- "$own/c1-lock"
printf 'runtime_write[%s]: OK\n' "$role"
