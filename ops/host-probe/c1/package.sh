#!/bin/bash
# Francis only. OUT must be a new directory. The manifest covers final install bytes.
set -euo pipefail
export LC_ALL=C
umask 077
base=60dba2cf8a81497c21b4e4408a269a25c577f01b
out=${1:?supply a new output directory}
mkdir -m 0700 -- "$out"
base_file() { git show "$base:ops/host-probe/$1"; }
for name in cape-probe-{bang,plus,decoy}.service cape-probe.slice; do
  base_file "units/$name" > "$out/$name"
done
cp -- ops/host-probe/stage1.sh "$out/stage1.sh"
# Retain the result and invocation ID until collected. Bound each synchronous start.
for name in bang plus; do
  printf '\nRemainAfterExit=yes\nTimeoutStartSec=30s\n' >> "$out/cape-probe-$name.service"
done
# A live decoy must have actually read its own non-empty synthetic credential.
printf '\nExecStartPre=/usr/bin/grep -q . /run/credentials/cape-probe-decoy.service/probe\nTimeoutStartSec=30s\n' >> "$out/cape-probe-decoy.service"
# Same read-only policy, running as the fixture UID with one nested writable path.
for role in scanner approval reviewer; do
  worker=$out/cape-probe-runtime-$role.service
  sed -e "s/Description=.*/Description=Cape C1 runtime directory check for $role/" \
      -e "s|^ExecStart=.*|ExecStart=/opt/cape-probe-exec/runtime.sh $role|" \
      -e '/^Environment=PROBE_MODE=/d' "$out/cape-probe-bang.service" > "$worker"
  printf 'RuntimeDirectory=cape-probe/%s\nRuntimeDirectoryMode=0700\nReadWritePaths=/run/cape-probe/%s\n' "$role" "$role" >> "$worker"
done
for f in runtime.sh host.sh rollback-files.sh assess.py; do cp -- "ops/host-probe/c1/$f" "$out/$f"; done
(cd "$out" && sha256sum -- cape-probe-*.service cape-probe.slice assess.py host.sh rollback-files.sh runtime.sh stage1.sh > SHA256SUMS)
sha256sum "$out/SHA256SUMS"
