# C1 host verification · systemd 255 · review candidate

**Hold for independent review of the workflow and the exact bundle digest.** The preliminary review covered commit `60dba2c`. The original G0/G1/G1b evidence and the N8/N8b results at 20/40 seconds stand. This procedure checks the corrected mount policy with synthetic fixtures. Each fresh installation needs its own collision, integrity and neighbour checks.

## Design findings

1. **The plus control answers two different questions.** On upstream v255.4 the executor omits the configured read-only and inaccessible paths for a fully privileged command. It passes the credential directory separately to namespace setup, which can mount a private credential tree containing just the unit's own credential. A successful plus create and source read can establish the filesystem controls even if the sibling credential is invisible. A different mount namespace from PID 1 is legitimate under plus. The exact Ubuntu package and actual mount evidence matter. [Executor parameters](https://github.com/systemd/systemd-stable/blob/v255.4/src/core/exec-invoke.c#L2875-L2906) · [Credential projection](https://github.com/systemd/systemd-stable/blob/v255.4/src/core/namespace.c#L2167-L2193)
2. **A missing decoy or lost exit status could give a misleading verdict.** The decoy now reads its own nonempty synthetic fixture as UID 65534 before its sleep process starts. The workflow checks its PID and invocation across tests. It records the synchronous start return code, unit result and process exit status separately. A retained oneshot supplies an invocation ID for the journal. The old time-window helper could return the status of its final inspection command.
3. **An explicit runtime write exception needs a positive operation.** Three short-lived, unprivileged oneshots reproduce the scanner, approval and reviewer runtime directory settings under synthetic names. Each checks UID/GID, mode 0700, parent/ctl read-only, its own mount writable and exclusive creation/removal. Web's object store is outside this runtime-directory check. Production paths and the launcher are outside the host footprint.

**Review decision before scheduling.** The existing C1 sibling-read criterion still requires a positive plus control. If source/write controls pass but both sibling accesses fail, record the mount subtest result and **C1 inconclusive**, then roll back. The decoy's positive self-read proves the fixture existed. It cannot prove that the explicit sibling mask alone caused the denial. If the reviewer needs a conclusive result about that mask on a manager that always projects credentials, approve a different discriminator separately. Never widen credential access to force a pass.

## Prepare the review bundle on Francis

From the repository root, in Bash:

```bash
set -euo pipefail
sh ops/host-probe/check-local.sh
bash ops/host-probe/c1/check-local.sh
review_dir=$(mktemp -d)
bash ops/host-probe/c1/package.sh "$review_dir/bundle"
(cd "$review_dir/bundle" && sha256sum --check --strict SHA256SUMS)
```

The package pins the original unit sources to `60dba2cf8a81497c21b4e4408a269a25c577f01b`. It includes the working-tree reporter and operator tools. Review the **rendered** six services and one slice, both payloads, verifier and host/cleanup scripts. Retaining oneshots and bounding start time are deliberate probe-only changes. Bang and plus use the same executable. The reviewer rebuilds the package, compares the manifest and communicates its SHA-256 independently of the bundle. Keep that value with the approval. The local checker exercises the verdicts and partial cleanup and verifies executable fixtures offline.

## Operator commands after separate host authorisation

Use the approved maintenance window and offline handoff. Place the reviewed flat bundle in a **new**, root-owned, mode-0700 case directory such as `/root/cape-c1-001/bundle`. Keep the case outside both install trees. The bundle and subsequent evidence are retained. The temporary footprint is two executables under `/opt/cape-probe-exec`, synthetic data under `/run/cape-probe`, seven volatile units, probe cgroups, manager reloads and synthetic journal entries.

1. In the established PM2 owner's existing session, confirm the expected daemon is live and capture `pm2 status` immediately before the run. Record daemon PID, each app's name, online state, PID and restart count. Compare with the approved baseline including `kbsk-staging` online on port 3000. Keep this timestamped record with the case. A new daemon, drift or missing owner-nominated neighbour stops the run. Keep that session observing neighbours through rollback.
2. In the host's root Bash shell, verify the handoff **before executing any bundled code**. Supply the real case path, independently supplied digest and the owner's actual systemd service names, including the PM2 supervisor where applicable.

```bash
set -euo pipefail
set +x
umask 077
cd /root/cape-c1-001/bundle
test "$(realpath -e .)" = "$PWD"
for dir in /root "${PWD%/*}" "$PWD"; do
  test "$(stat -c '%u:%g' "$dir")" = 0:0
  test -z "$(find "$dir" -maxdepth 0 -perm /022 -print)"
done
test -z "$(find . -mindepth 1 \( ! -type f -o ! -uid 0 -o ! -gid 0 -o -perm /022 -o ! -links 1 \) -print)"
read -rp 'Independently approved manifest SHA-256: ' C1_SHA256
[[ $C1_SHA256 =~ ^[a-f0-9]{64}$ ]]
export C1_SHA256
printf '%s  SHA256SUMS\n' "$C1_SHA256" | sha256sum --check --strict
sha256sum --check --strict SHA256SUMS
read -rp 'Owner-nominated systemd service names, space-separated: ' C1_NEIGHBOURS
export C1_NEIGHBOURS
```

3. Start the single workflow. It holds the case lock through setup, bang, the three runtime checks, plus and rollback. On a failed stage it goes directly to rollback and preserves both exit statuses. Interrupt on unexpected neighbour activity. Each phase prints its private evidence filename.

```bash
bash ./host.sh run
```

Setup checks the target and running manager version, current unit and path collisions, UID availability, headroom, pending manager edits and neighbours. It copies only the verified files, checks installed bytes, modes and ownership, runs systemd's verifier on the installed paths, and checks loaded fragment paths and drop-ins. The expected special-user warnings refer to the disposable fixture identity. Each test retains the namespace ID, covering VFS flags, invocation-specific allowlisted output and exit statuses. Runtime exceptions run after bang and before plus so an inconclusive sibling result leaves their independent evidence available. A failed stage closes the test sequence.

## Rollback and recovery

After a disconnect, re-enter the **same** root-owned case, recheck the manifest against the independently approved digest as above, export `C1_SHA256`, and run:

```bash
bash ./host.sh rollback
```

Rollback stops only recorded probe starts, checks cgroup ownership and emptiness, and removes attributed files in reverse creation order using the device/inode receipts. Copied code must also match the bundle. A partial setup before reload intent only needs file cleanup. A manager reload attempt is recorded before it occurs so recovery can reconcile an interrupted reload. Cleanup checks pending edits again before the final reload. It leaves the private case records and original journal intact.

A changed inode, checksum, symlink, mount, unknown directory entry, pending unrelated edit or boot ID mismatch requires manual reconciliation. Preserve the error and inventory. A crash between creating an entry and recording its receipt can leave an unattributed entry. Do not recursively remove either tree or retry setup over it. After reboot, compare any surviving `/opt/cape-probe-exec` files individually with the original receipts, modes and reviewed bundle before authorising their removal.

Capture the final PM2 status from the same owner session even after a failed run. Compare states, PIDs, restart counts and the approved listener against the before record. Retain both PM2 observations, digest, package revision, per-phase logs, snapshots, verifier output, exit statuses and rollback result. Omit credential contents, environment dumps and unrelated journals.

## Acceptance criteria

| Gate | Evidence required |
| --- | --- |
| Setup | Approved source manifest and every installed file match. Ubuntu target runs systemd 255. Expected loaded fragment, zero drop-ins, successful verifier with only the approved warnings. Decoy is live and has read its synthetic credential. |
| Bang | Start and process exit 0, unit success, UID 0, private mount namespace, reviewed capability mask, empty ambient set, NNP 1 and seccomp 2. Covering mounts of root, run and ctl are ro. Exclusive ctl creation fails with the C-locale read-only filesystem diagnostic (EROFS). All four source/sibling accesses fail. Own credential directory listing succeeds. |
| Runtime | Each of the three named worker fixtures remains unprivileged, sees ro run/ctl and rw on its designated directory, creates and removes its lock marker, exits 0 and loses the runtime directory on stop. |
| Plus | Start and process exit 0, unit success, UID 0 and manager bounding set. The ctl mount is rw, exclusive create/remove succeeds, synthetic source and live decoy reads/listings succeed, own credential directory lists. Record the observed namespace and credential mount flags. Hidden sibling with passing filesystem controls leaves C1 open. |
| Rollback and neighbours | No probe files, units, cgroups or credential mounts left in the install footprint. Neighbour systemd states/PIDs/restarts, PM2 app observations, listeners, non-probe failures and host mount inventory match baseline. Both workflow and rollback return 0 for a full pass. |

Any missing evidence, mismatched result, unexplained neighbour change or cleanup failure leaves host acceptance open. This workflow supplies no production or later-phase authorisation.
