#!/bin/sh
# TEMPORARY HOST PROBE stage-1 reporter (Phase 5A rev 4). Runs as ROOT inside the unit sandbox,
# started by ExecStart=! (test) or ExecStart=+ (negative control). Prints OK/FAIL only, never contents.
set -u
P=/run/cape-probe
say() { printf '%s\n' "$*"; }
try() {
  name=$1
  shift
  if "$@" >/dev/null 2>/tmp/probe.err; then say "$name: OK"; else say "$name: FAIL: $(head -c 160 /tmp/probe.err | tr '\n' ' ')"; fi
}
say "== stage1 variant=${PROBE_MODE:-?} uid=$(id -u)"
grep -E '^(CapBnd|CapEff|CapPrm|CapAmb|NoNewPrivs|Seccomp):' "/proc/$$/status"
say "mnt_ns=$(readlink "/proc/$$/ns/mnt")"
try read_secret cat "$P/secrets/probe-secret"
try ls_secrets ls "$P/secrets"
try ls_decoy_creds ls /run/credentials/cape-probe-decoy.service
try read_decoy_cred cat /run/credentials/cape-probe-decoy.service/probe
try ls_own_creds ls "${CREDENTIALS_DIRECTORY:-/nonexistent}"
try write_ctl sh -c ": > $P/ctl/stage1-write-test"
rm -f "$P/ctl/stage1-write-test"
