# Phase 5A revision 4 · G1 operator commands

Target: `vm400masc.kbsktrading.net`. Use only after approval for the new temporary
`/opt/cape-probe-exec` footprint. Use the established operator login. Record times,
file names, checksums of **code**, modes and verifier diagnostics. Keep shell tracing off.
The operator reported a verified 13-file revision 3 source tree, staged G1 files,
a verifier failure on the noexec mount, no manager reload and no unit starts.
Select **staged** for that host. Use **fresh** only after a separate clean G0.
Run the blocks in order, keeping the indicated shells open. Any error stops the sequence.
Do not repeat a failed write block over a partial install. Use the inventory and
file-only rollback below for confirmed probe artifacts.

## A. Host inventory and preflight

In a dedicated root Bash shell on the target, first confirm the target against the
established SSH session. Define the names below once. Section F reuses them.

```bash
set -euo pipefail
set +x
umask 077
mode=staged
P=/run/cape-probe
E=/opt/cape-probe-exec
D=/run/systemd/system
R=$P/src-r4
H=$R/ops/host-probe
units=(cape-probe-launch@.service cape-probe-launch-ro@.service
       cape-probe-launch-none@.service cape-probe-direct@.service
       cape-probe-bang.service cape-probe-plus.service cape-probe-decoy.service cape-probe.slice)
sources=(ops/libexec/cape-vault-ns-launch.example ops/host-probe/check-local.sh
         ops/host-probe/helpers.sh ops/host-probe/payload.sh ops/host-probe/stage1.sh)
for u in "${units[@]}"; do sources+=("ops/host-probe/units/$u"); done
absent() { [[ ! -e $1 && ! -L $1 ]]; }
metadata() { # Require canonical path (including parents), type, numeric uid:gid:mode.
  [[ $(realpath -e -- "$1") == "$1" ]]
  [[ $(stat -c '%F:%u:%g:%a' -- "$1") == "$2" ]]
}
no_nested_mounts() {
  local mounts
  mounts=$(findmnt -rn -o TARGET)
  awk -v p="$1" '$0 == p || index($0,p "/")==1 {hit=1} END {exit hit}' <<< "$mounts"
}
idle() {
  local loaded
  loaded=$(systemctl list-units --all --no-legend --plain 'cape-probe*')
  [[ -z $loaded ]]
  absent /sys/fs/cgroup/cape.slice
}
```

Record the mount readings. Confirm the P6 UID is still unused. The checks allow the
known staged revision 3 files, but refuse a pre-existing executable directory, a
previous revision 4 attempt, changed ownership or a loaded probe unit.

```bash
test "$(id -u)" = 0
export LC_ALL=C
findmnt -T /run -o TARGET,FSTYPE,OPTIONS
findmnt -T /opt -o TARGET,FSTYPE,OPTIONS
run_opts=$(findmnt -n -o OPTIONS -T /run)
opt_opts=$(findmnt -n -o OPTIONS -T /opt)
for flag in rw nosuid nodev noexec; do [[ ,$run_opts, == *,"$flag",* ]]; done
[[ ,$opt_opts, == *,rw,* && ,$opt_opts, != *,noexec,* ]]
[[ $(findmnt -n -o FSTYPE -T /opt) == ext4 ]]
for dir in /opt /run "$D"; do
  [[ $(realpath -e -- "$dir") == "$dir" ]]
  [[ $(find "$dir" -maxdepth 0 -type d -uid 0 ! -perm /022 -print) == "$dir" ]]
done
idle
test "$(id -u nobody)" = 65534
test "$(getent group nogroup | cut -d: -f3)" = 65534
ps -eo uid= | awk '$1 == 65534 {busy=1} END {exit busy}'
no_nested_mounts "$P"
# Refuse an unrecognised probe unit or a drop-in before verify can pick it up.
for path in "$D"/cape-probe*; do
  if absent "$path"; then continue; fi
  known=false
  for u in "${units[@]}"; do
    if [[ $path == "$D/$u" ]]; then known=true; break; fi
  done
  [[ $mode == staged && $known == true ]]
  no_nested_mounts "$path"
done
absent "$E"
absent "$R"
absent "$P/helpers.sh"
if [[ $mode == staged ]]; then
  metadata "$P" 'directory:0:0:755'
  metadata "$P/src" 'directory:0:0:700'
  metadata "$P/bin" 'directory:0:0:755'
  metadata "$P/ctl" 'directory:0:0:755'
  metadata "$P/secrets" 'directory:0:0:700'
  for f in secrets/probe-secret secrets/probe-secret-decoy ctl/hold.env; do
    metadata "$P/$f" 'regular file:0:0:600'
  done
  metadata "$P/objects" 'directory:65534:65534:700'
  metadata "$P/objects/seed.txt" 'regular file:65534:65534:600'
else
  [[ $mode == fresh ]]
  absent "$P"
  for u in "${units[@]}"; do absent "$D/$u"; done
  mkdir -m 0755 -- "$P"
fi
mkdir -m 0700 -- "$R"
```

## B. Workstation package and transfer

From the repository root in Bash, use the reviewed **working tree** for revision 4.
Revision 3 commit `276475584169c3f49daf2fe7f87091a0e05fd130` supplies a separate
manifest for rechecking the original stage. Transfer only the named repository files,
the locally derived launcher and the two manifests. Keep the displayed revision 4
manifest digest in the operator record for comparison in C. Use the authorised login
for the named host. The remote reader requires the operator's established sudo access.

```bash
set -euo pipefail
umask 077
sh ops/host-probe/check-local.sh
bundle=$(mktemp -d)
rev3=276475584169c3f49daf2fe7f87091a0e05fd130
mapfile -t files < <(git ls-tree -r --name-only "$rev3" -- ops/host-probe ops/libexec/cape-vault-ns-launch.example)
test "${#files[@]}" = 13
for f in "${files[@]}"; do
  test -f "$f" && test ! -L "$f" || exit 1
  cp --parents -- "$f" "$bundle"
  digest=$(git show "$rev3:$f" | sha256sum)
  printf '%s  %s\n' "${digest%% *}" "$f" >> "$bundle/r3.sha256"
done
sh ops/host-probe/check-local.sh --render-launcher > "$bundle/launch"
(cd "$bundle" && sha256sum -- "${files[@]}" launch r3.sha256 > r4.sha256)
sha256sum "$bundle/r4.sha256"
tar -C "$bundle" -cf - -- "${files[@]}" launch r3.sha256 r4.sha256 |
  ssh vm400masc.kbsktrading.net 'sudo -n tar --keep-old-files --no-same-owner --no-same-permissions -xf - -C /run/cape-probe/src-r4'
```

## C. Host integrity check before replacement

In the same host shell, paste the digest from B at the prompt. Recheck the original
source and each installed revision 3 file before touching its destination. An absent
or mismatched staged unit, unknown file, unexpected mount or mismatched mode requires
inspection. Leave existing synthetic secrets, seed and monitoring state in place.

```bash
read -rp 'Workstation SHA-256 of r4.sha256: ' manifest_digest
[[ $manifest_digest =~ ^[0-9a-f]{64}$ ]]
(cd "$R" && printf '%s  r4.sha256\n' "$manifest_digest" | sha256sum --check --strict -)
(cd "$R" && sha256sum --check --strict r4.sha256)
if [[ $mode == staged ]]; then
  (cd "$P/src" && sha256sum --check --strict "$R/r3.sha256")
  old=$P/src/ops/host-probe
  for u in "${units[@]}"; do
    metadata "$D/$u" 'regular file:0:0:644'
    cmp -- "$old/units/$u" "$D/$u"
  done
  for f in payload.sh stage1.sh helpers.sh; do
    perm=755
    if [[ $f == helpers.sh ]]; then perm=644; fi
    metadata "$P/bin/$f" "regular file:0:0:$perm"
    cmp -- "$old/$f" "$P/bin/$f"
  done
  metadata "$P/bin/launch" 'regular file:0:0:755'
  sed 's|^NODE=/opt/cape-probe-exec/payload.sh$|NODE=/run/cape-probe/bin/payload.sh|' "$R/launch" |
    cmp - "$P/bin/launch"
  test "$(find "$P/bin" -mindepth 1 -maxdepth 1 | wc -l)" -eq 4
fi
```

## D. Prepare executables, data and units

The exclusive `mkdir` under a trusted `/opt` prevents reuse of an existing tree.
Only the three listed executables belong there. The launcher path used by the unit
also becomes `"$0"` for the second-stage exec. The helper is a 0644 file sourced
by the operator. Service processes never execute a script from `/run`.

```bash
idle
mkdir -m 0755 -- "$E"
for f in payload.sh stage1.sh; do install -o root -g root -m 0755 -T "$H/$f" "$E/$f"; done
install -o root -g root -m 0755 -T "$R/launch" "$E/launch"
install -o root -g root -m 0644 -T "$H/helpers.sh" "$P/helpers.sh"
if [[ $mode == fresh ]]; then
  mkdir -m 0755 -- "$P/ctl"
  mkdir -m 0700 -- "$P/secrets"
  mkdir -m 0700 -- "$P/objects"
  r=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')
  printf 'SYNTHETIC-PROBE-%s-main\n' "$r" > "$P/secrets/probe-secret"
  printf 'SYNTHETIC-PROBE-%s-decoy\n' "$r" > "$P/secrets/probe-secret-decoy"
  printf 'PROBE_MARKER=SYNTHETIC-PROBE-%s-env\n' "$r" > "$P/ctl/hold.env"
  printf 'SYNTHETIC-PROBE-%s-seed\n' "$r" > "$P/objects/seed.txt"
  unset r
  chown nobody:nogroup "$P/objects/seed.txt" "$P/objects"
  readlink -f "$(command -v node)" > "$P/ctl/node.path"
  : > "$P/ctl/spy.targets"
  chmod 0644 "$P/ctl/node.path" "$P/ctl/spy.targets"
fi
metadata "$P/secrets" 'directory:0:0:700'
for f in secrets/probe-secret secrets/probe-secret-decoy ctl/hold.env; do
  metadata "$P/$f" 'regular file:0:0:600'
done
metadata "$P/helpers.sh" 'regular file:0:0:644'
metadata "$E" 'directory:0:0:755'
for f in launch payload.sh stage1.sh; do
  metadata "$E/$f" 'regular file:0:0:755'
  test -x "$E/$f"
  sh -n "$E/$f"
done
cmp "$R/launch" "$E/launch"
cmp "$H/payload.sh" "$E/payload.sh"
cmp "$H/stage1.sh" "$E/stage1.sh"
cmp "$H/helpers.sh" "$P/helpers.sh"
for u in "${units[@]}"; do
  install -o root -g root -m 0644 -T "$H/units/$u" "$D/$u"
  cmp -- "$H/units/$u" "$D/$u"
done
```

## E. Offline verification and G1 stop

Verify all eight **installed** unit files in one invocation. Capture the real exit
status and complete diagnostics in the private source directory. UID 65534 is a
shared special identity; the warning is expected for each `User=nobody` probe
service. The synthetic-only, unused-UID precondition bounds that risk. A new UID
consumer invalidates P6. The plus-prefixed reader remains a separately gated
negative control. A permission failure, missing executable, unknown directive or
any other diagnostic needs review even if the verifier exits zero.

```bash
installed=()
for u in "${units[@]}"; do installed+=("$D/$u"); done
rc=0
systemd-analyze verify --man=no "${installed[@]}" > "$R/verify.log" 2>&1 || rc=$?
cat "$R/verify.log"
test "$rc" -eq 0
if grep -Ev '^/run/systemd/system/cape-probe-[^:]+\.service:[0-9]+: Special user nobody configured, this is not safe!$' "$R/verify.log"; then
  echo 'Stop for review of verifier diagnostics' >&2
  exit 1
fi
if [[ $mode == staged ]]; then
  for f in launch payload.sh stage1.sh helpers.sh; do rm -- "$P/bin/$f"; done
  rmdir -- "$P/bin"
fi
idle
```

Record the baseline three times in the established operator shell, with the
owner-nominated `NEIGHBOUR_UNITS` from §3 of the acceptance runbook. The snapshot
helper permits ordinary empty process counts. Run it with its original shell
semantics. Leave tracing off.

```bash
. "$P/helpers.sh"
T_START=$(date '+%F %T')
(set +eu; set +o pipefail; probe_snapshot)
sleep 120
(set +eu; set +o pipefail; probe_snapshot)
sleep 120
(set +eu; set +o pipefail; probe_snapshot)
```

Stop after recording the three snapshots, the verification result and the offline
file inventory. Compare neighbour state, restart counts, listeners, mounts and
available memory. Any drift goes to the owner. G1 ends before daemon reload, start,
enablement, namespace execution or stress tests.

## F. File-only rollback

For the reported G1 state, first confirm from the session record that **no reload
or start occurred**, then run `idle` before removing files. If uncertain, stop and reconcile with the operator. For a
later, separately authorised gate, complete the stop and cgroup checks in §9
of the acceptance runbook first and select `rollback_gate=later` in the block below. Use the same root shell or repeat **only the
definitions in the first block of A**, with `LC_ALL=C`. Use the G0/G1 inventory
to confirm ownership of each existing artifact to be removed. In particular,
a collision that stopped preflight is **never** a cleanup target. If attribution
is incomplete, stop before deletion.

```bash
rollback_gate=g1
if [[ $rollback_gate == g1 ]]; then idle; else [[ $rollback_gate == later ]]; fi
# Inventory names and mountpoints only. Refuse symlinks or mounts within either tree.
for tree in "$P" "$E"; do
  if ! absent "$tree"; then
    [[ $(realpath -e -- "$tree") == "$tree" ]]
    no_nested_mounts "$tree"
    links=$(find "$tree" -xdev -type l -print -quit)
    [[ -z $links ]]
    find "$tree" -xdev -printf '%m %U:%G %p\n'
  fi
done
# Remove only a named file, or a named empty directory. Unknown entries survive.
drop_file() { if ! absent "$1"; then [[ -f $1 && ! -L $1 ]]; rm -- "$1"; fi; }
drop_dir()  { if ! absent "$1"; then rmdir -- "$1"; fi; }
for u in "${units[@]}"; do
  if ! absent "$D/$u"; then
    no_nested_mounts "$D/$u"
    metadata "$D/$u" 'regular file:0:0:644'
    if ! cmp -s "$H/units/$u" "$D/$u"; then cmp "$P/src/ops/host-probe/units/$u" "$D/$u"; fi
    drop_file "$D/$u"
  fi
done
for f in launch stage1.sh payload.sh; do
  if ! absent "$E/$f"; then
    metadata "$E" 'directory:0:0:755'
    metadata "$E/$f" 'regular file:0:0:755'
    expected="$H/$f"
    if [[ $f == launch ]]; then expected="$R/launch"; fi
    cmp -- "$expected" "$E/$f"
    drop_file "$E/$f"
  fi
done
drop_dir "$E"
for f in launch stage1.sh payload.sh helpers.sh; do drop_file "$P/bin/$f"; done
drop_dir "$P/bin"
for f in helpers.sh ctl/hold.env ctl/node.path ctl/spy.targets secrets/probe-secret \
         secrets/probe-secret-decoy objects/seed.txt; do drop_file "$P/$f"; done
for dir in ctl secrets objects; do drop_dir "$P/$dir"; done
for f in r3.sha256 r4.sha256 launch verify.log; do drop_file "$R/$f"; done
for src in "$P/src" "$R"; do
  for f in "${sources[@]}"; do drop_file "$src/$f"; done
  for dir in ops/host-probe/units ops/host-probe ops/libexec ops; do drop_dir "$src/$dir"; done
  drop_dir "$src"
done
drop_dir "$P"
absent "$P"
absent "$E"
for u in "${units[@]}"; do absent "$D/$u"; done
```

An unexpected non-empty directory is a finding. Keep it for attribution. During
G1-only rollback, use the read-only `idle` check and finish here. After reboot,
`/run` evidence may have vanished while `/opt/cape-probe-exec` persists. Reconcile
its three files against the retained workstation bundle and operator record before
removing them. Preserve the local evidence according to the operator's retention
practice.
