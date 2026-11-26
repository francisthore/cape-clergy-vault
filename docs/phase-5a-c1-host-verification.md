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

The package pins the original unit sources to `60dba2cf8a81497c21b4e4408a269a25c577f01b`. It includes the working-tree reporter and operator tools. Review the **rendered** six services and one slice, both payloads, verifier and host/cleanup scripts. Retaining oneshots and bounding start time are deliberate probe-only changes. Bang and plus use the same executable. The reviewer rebuilds the package, compares the manifest and communicates its SHA-256 independently of the bundle. Keep that value with the approval. The local checker exercises the verdicts and partial cleanup and verifies executable fixtures offline. It also runs the **actual** `stage1.sh` and `runtime.sh`, first from the repository and again from the packaged bytes, inside a private unprivileged user and mount namespace (`unshare -Um`, required; the test fails rather than skips without it) and passes their real output to the assessor. That fixture stacks self-bind mounts, projects the credential tree, masks sources, trims capabilities and applies no_new_privs and seccomp. It protects the reporter and assessor contract only. It does not replace the systemd 255 host evidence.

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
| Bang | Start and process exit 0, unit success, UID 0, private mount namespace, reviewed capability mask, empty ambient set, NNP 1 and seccomp 2. Covering mounts of root, run and ctl are ro. Exactly one record is kept for each of those paths and for the credential parent and the unit's own directory. A stacked self-bind reports only its topmost layer. Exclusive ctl creation fails with the C-locale read-only filesystem diagnostic (EROFS). All four source/sibling accesses fail. Own credential directory listing succeeds. |
| Runtime | Each of the three named worker fixtures remains unprivileged, sees ro run/ctl and rw on its designated directory, creates and removes its lock marker, exits 0 and loses the runtime directory on stop. |
| Plus | Start and process exit 0, unit success, UID 0 and manager bounding set. The ctl mount is rw, exclusive create/remove succeeds, synthetic source and live decoy reads/listings succeed, own credential directory lists. Record the observed namespace and credential mount flags. Hidden sibling with passing filesystem controls leaves C1 open. |
| Rollback and neighbours | No probe files, units, cgroups or credential mounts left in the install footprint. Neighbour systemd states/PIDs/restarts, PM2 app observations, listeners, non-probe failures and host mount inventory match baseline. Both workflow and rollback return 0 for a full pass. |

Any missing evidence, mismatched result, unexplained neighbour change or cleanup failure leaves host acceptance open. This workflow supplies no production or later-phase authorisation.

## Case 004 record and C1 closure review · 26 November 2026 · split approved, C1b open

**Review decision (26 November 2026).** The C1a/C1b separation is approved. C1a is verified on Case 004 evidence. Effective sibling-credential denial was observed; attribution to the explicit sibling `InaccessiblePaths=` rule is unproven. `bang-nomask` is **not** implemented or scheduled. No production directive changes. **C1b stays formally open** until the revised criteria below are independently approved.

**Result: sibling credential control INCONCLUSIVE. This is not a filesystem-restriction failure.** Operator results, preserved as reported: setup passed; bang passed; runtime (scanner, approval, reviewer) passed; plus read the synthetic source, wrote ctl and read its own credential; plus could not see the live decoy's credential directory and exited 1, as the assessor is designed to do; rollback passed; PM2 and Nginx were unchanged and the original host mount fingerprint was restored. Manager: systemd 255.4-1ubuntu8.19 (exact package version observed). The decoy fixture passed its positive self-read at setup, so it existed and was readable by UID 65534 before the tests.

| Question | Status | Basis |
| --- | --- | --- |
| Does `!` apply the explicit mask to an independently readable source? | **Proven** | Plus read `secrets` (positive control); bang could not. |
| Does `!` keep `/run/cape-probe/ctl` read-only while `+` can write? | **Proven** | Bang EROFS; plus create/remove succeeded. |
| Do the scanner, approval and reviewer runtime-directory exceptions work? | **Proven** | Runtime phase. |
| Does the explicit `-/run/credentials/<sibling>` line deny sibling credentials under `!`? | **Unproven** | The plus control hid the decoy with no mask in force, so a hidden decoy is also what the unit's own credential projection would produce under `!`. |
| Is the sibling denial under `!` real? | Observed, mechanism unattributed | All four bang accesses failed. |

**Why plus cannot be the positive control.** On v255.4 a `+` command skips the unit's read-only and inaccessible lists, but the credential directory is still handed to namespace setup. The decoy was hidden without any `InaccessiblePaths=`. That is consistent with projection hiding it, but only the upstream source and the observation support this; the Case 004 in-unit mount records for bang and plus were retained and are recorded below (systemd 255.4-1ubuntu8.19). They show separate per-unit credential mounts but do not by themselves show that the credential parent contained only one unit. The local `bang-projected` fixture passes the assessor with no decoy mask, so a bang pass does not attribute the denial to the mask either.

**Independently readable peer fixture.** Useful only outside `/run/credentials`. A synthetic peer under `/run/cape-probe` is readable without a mask and denied with one, which is a valid discriminator for **explicit masking**, and the existing `secrets` source already provides exactly that pair (proved above). It adds no coverage of the credential path: any fixture placed under `/run/credentials` is subject to projection in plus and in bang, so it cannot separate the mechanisms. Do not add one.

**Separation of concerns.** `test_discriminator.py` shows locally that mask-alone hides a peer outside the credential tree, projection-alone hides a credential peer with no mask, and three of four mask/projection combinations deny the credential peer. Local only; it supports the attribution logic, not systemd 255 behaviour.

**Case 004 mount observations (retained, unchanged).** Manager package observed: systemd 255.4-1ubuntu8.19.

| Unit | Retained mount records |
| --- | --- |
| Bang | `mount[/run/credentials]=/run/credentials tmpfs ro,nosuid,nodev,noexec`<br>`mount[/run/credentials/cape-probe-bang.service]=/run/credentials/cape-probe-bang.service tmpfs ro,nosuid,nodev,noexec,relatime,nosymfollow` |
| Plus | `mount[/run/credentials]=/run/credentials tmpfs ro,nosuid,nodev,noexec`<br>`mount[/run/credentials/cape-probe-plus.service]=/run/credentials/cape-probe-plus.service tmpfs ro,nosuid,nodev,noexec,relatime,nosymfollow` |

**Path S — Strict attribution requirements.** Path S establishes mask-specific enforcement. It is one of two alternative routes to closing C1b (see Path P below); it is not mandatory if Path P receives valid independent security sign-off. Neither path is formally approved. Separate approval is needed; no production directive changes:

1. **C1a, mask and write boundary.** Closed on Case 004 evidence for the tested revision.
2. **C1b, sibling mask attribution.** One additional paired run on the `!` path: the existing bang unit, plus a probe-only `cape-probe-bang-nomask` unit identical to it except for the single `-/run/credentials/cape-probe-decoy.service` line, with the same live decoy and reporter. Both retain the in-unit mount table for `/run/credentials`.
   - Sibling visible without the line and denied with it: the mask is load-bearing; C1b closed.
   - Sibling denied in both: projection denies it independently. The mask is defence in depth that this host does not discriminate. Record it, pin the systemd package revision in the deployment prerequisites, and do not claim the mask is proven. Never remove the production line on this basis.
   - Sibling visible in both: real exposure; keep C1 open and stop.
3. The Case 004 plus and bang mount records (above) show separate credential mounts for each unit. They do not show the contents of the credential parent, so a Path S run should also retain the in-unit listing of `/run/credentials`.

**Acceptance criteria.** The table above is unchanged: the plus sibling-read requirement still reads as required and the assessor still reports INCONCLUSIVE with C1 open. Proposed for reviewer decision only: replace the plus sibling-read requirement with "recorded, not required", and require the C1b pair. Justification: plus sibling visibility is a property of systemd's credential projection, not of the sandbox under review, so requiring it tests the manager. The replacement criterion tests the production mechanism, with the bang denials, source control and write control unchanged. Do not make this change without that review.

The acceptance document's C2c control compares an ordinary `direct@` unit with the `!` launcher, so it also does not isolate the mask on the `!` path. The C1b pair addresses that gap.

## C1b alternative acceptance path: credential projection · proposed, not in force

Path S and Path P are **alternatives**: either can close C1b, and Path S is not required if Path P receives valid independent security sign-off. **Neither is formally approved or in force.** **C1b remains OPEN.**

**Path S (strict, preserved; mask-specific enforcement).** The paired `!` run with and without the sibling mask line, as specified above. It is the only technically discriminating test of the explicit rule. A later approved run may use it; a "mask is load-bearing" outcome closes C1b as **proven** and supersedes Path P. It is neither implemented nor scheduled now.

**Path P (projection; documented residual-risk acceptance).** Accept the observed effective denial on the basis that systemd's own credential projection hides sibling credentials from a unit, while stating plainly that the explicit rule is **not shown to be the cause**. This path can only ever record C1b as *accepted with residual risk*, never *proven*.

### Proposed evidence requirements for Path P

All must hold and be retained with the approval:

1. **Version.** Manager package exactly `systemd 255.4-1ubuntu8.19` at the Case 004 run and at any later verification, recorded from the host package database by the operator. Any other version triggers reassessment before Path P applies.
2. **Fixture.** The live decoy completed its positive self-read as UID 65534 (setup gate), with PID and invocation unchanged through bang and plus.
3. **Bang.** Case 004 bang passed unchanged: all four source/sibling accesses denied, own credential listing succeeded, ctl read-only, capability, no_new_privs and seccomp checks matched.
4. **Plus.** The plus control read the source and wrote ctl, and could not see the decoy's credential directory. This is recorded as a statement about projection, not as a pass of the sibling control.
5. **Projection observation.** Retained in-unit evidence that the credential parent is presented as the unit's own view and exposes only the unit's own credential. Case 004 status, partial:
   - Both units had separate credential mounts (records above).
   - The live decoy successfully read its own credential.
   - Bang and plus were denied sibling credential access.
   - This evidence supports systemd credential projection, but projection is **not conclusively established**.
   - The mount records do not independently prove that the credential parent contained only one unit.
   - The explicit sibling mask remains **unproven**.

   Unless the independent reviewer accepts this as sufficient, a separately approved, read-only observation of the credential parent's contents is required before sign-off.
6. **Rollback.** Case 004 rollback passed, PM2 and Nginx unchanged and the original host mount fingerprint restored.
7. **Production lines unchanged.** The explicit `-/run/credentials/<sibling>` lines stay in all four production templates. They are defence in depth. No requirement relies on removing or relaxing them.

### Limitations that must be accepted in the sign-off

- Attribution is unproven. If projection behaviour changes, the explicit rule may be the only barrier and has not been shown to work on its own.
- The evidence is specific to the observed package, kernel and unit settings. It says nothing about other versions or distributions.
- Projection hides sibling credentials from the unit's view. It does not address credential exposure by other routes (process inspection, logs, shared UID), which are tested separately (N-series, C3-C6).
- Only synthetic credentials were used. Real credential sets remain Phase 5B.

### Independent sign-off

A reviewer who is neither the operator nor the author of this workflow records: the exact version, the evidence digest, the retained observations from requirements 1-6, acceptance of each limitation above, and the date. Without that record C1b remains open. Operator or author self-approval does not satisfy it.

### Reassessment triggers

Repeat the review (Path S is then preferred) after: any change to the systemd package version or a security update to it; changes to the credential-related or sandbox directives in the production units; changes to how credentials are loaded or named; a distribution or major kernel upgrade; or evidence that sibling credentials became visible.

### Proposed criteria change (the exact edit for review)

| Row | In force today | Proposed (not in force) |
| --- | --- | --- |
| Plus, sibling read | Live decoy reads/listings succeed; hidden sibling with passing controls leaves C1 open. | Recorded, not required. A hidden sibling is reported as a projection observation, and the assessor keeps reporting INCONCLUSIVE until C1b is closed. |
| C1b (new) | Not defined. | Closed only by Path S "proven", or by Path P with all seven requirements and independent sign-off, recorded as *accepted with residual risk*. |
| Bang, source and sibling denial | All four accesses fail. | Unchanged. |

Security justification: the plus sibling read measures systemd's projection, not the sandbox under review, so requiring it cannot be met on this manager and does not test the production mechanism. Replacing it with Path S or the signed-off Path P keeps every bang denial and the source and write controls, adds explicit version pinning and reassessment triggers, and does not relax any production directive.
