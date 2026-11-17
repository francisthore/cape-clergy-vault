# Phase 5A — VPS feasibility assessment (revision 3: second read-only inspection)

Prepared 17 November 2026, revised after the owner's two read-only inspections of the shared VPS.
**Status: design adapted and locally checked; nothing installed, deployed or run on the
host; a temporary host probe is prepared and awaiting owner approval.** Revisions 1 and 2 are preserved in git history. Companion documents:
[host acceptance tests](phase-5a-host-acceptance-tests.md),
[Phase 5B plan](phase-5b-staging-execution-plan.md),
[deployment preflight](phase-5-deployment-preflight.md).

Legend used throughout: **VERIFIED** = reported by the owner from the host;
**LOCAL** = checked on the development workstation only (WSL2, systemd 249, kernel 5.15, not the VPS);
**ASSUMED** = reasoned from documentation or recollection; **UNTESTED** = a control whose
effect on the real host has not been demonstrated.

## 1. Verified host facts and what is still assumed

| Fact                                                                                                                                                                     | Status                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Ubuntu 24.04.4 LTS, kernel 6.8.0-147-generic, systemd 255                                                                                                                | VERIFIED                             |
| 2 vCPU; 3.8 GiB RAM, 2.5 GiB available (one snapshot); 3.8 GiB swap unused                                                                                               | VERIFIED (a single moment, not peak) |
| 59 GB free disk; > 10 M free inodes                                                                                                                                      | VERIFIED                             |
| Node.js 22.23.2 (global); Bun absent; TCP 3300 unused                                                                                                                    | VERIFIED                             |
| Neighbours: makoti-production, onestop-kitchen-production, qahead-web, qahead-email-worker, qahead-notification-worker; `kbsk-staging` stopped on purpose                | VERIFIED (names only)                |
| KVM virtualisation (not a container); AppArmor active; `systemd-oomd` inactive; util-linux 2.39.3; unified cgroup v2; `system.slice` controllers `cpu memory pids`       | VERIFIED (second inspection)         |
| PostgreSQL 16 online on 5432 (socket directory, `max_connections`, `pg_hba` still not reported); port 3300 unused; `kbsk-staging` stopped on purpose; all others running | VERIFIED                             |
| Expected load: approximately five users daily                                                                                                                            | OWNER ESTIMATE                       |
| CPU architecture (artifact assumes x86_64): not reported                                                                                                                 | **ASSUMED** (probe P1)               |
| `io` controller: **absent** from `system.slice`; whether the kernel offers it at the root, and the block scheduler (BFQ needed for `io.weight`), not reported            | VERIFIED absent / probe I1–I2        |
| `setpriv`, `flock`, `perl`, `unshare` binaries and `max_{pid,mnt}_namespaces` (part of util-linux 2.39.3, expected)                                                      | ASSUMED (probe P2–P3)                |
| AppArmor profiles that could confine `unshare`, `setpriv`, `mount`, `sh`; denials in the kernel log                                                                      | UNTESTED (probe A1–A3)               |
| Nginx state, who manages the five apps (PM2/systemd)                                                                                                                     | NOT INSPECTED                        |
| Peak-hour memory/CPU of the neighbours; whether `kbsk-staging` will return                                                                                               | UNKNOWN                              |

**What the second inspection changes**

- **No I/O control exists on this host.** `system.slice` has no `io` controller, so `IOWeight=20` in the unit and slice templates is almost certainly inert, and it must not be cited as I/O protection (earlier revisions did, §6). Even if `io` were enabled, `io.weight` needs the BFQ scheduler or iocost, which a virtio disk rarely uses. Enabling `io` would be a host-wide change to the root cgroup; it is not proposed. Protection against I/O contention therefore rests on workload size (about five users, no PDFs in synthetic staging), memory and task limits, journald limits and the owner's acceptance of the residual risk (probe I1–I2).
- **`systemd-oomd` is inactive**, so no pressure-based killer acts on our slice or the neighbours: only the kernel's cgroup OOM (inside our `MemoryMax`) and the global OOM killer (where `OOMScoreAdjust=500` makes us the preferred victim) apply. Probe test M6 is not applicable.
- **AppArmor is active.** The launcher uses no user namespace, so Ubuntu 24.04's unprivileged-userns restriction should not apply, but profiles or denials affecting root-run `unshare`/`setpriv`/`mount` are untested (A1–A3). Failure would be a failed launch, never a weaker start.
- **KVM is full virtualisation**, which removes the container-class failure mode for PID/mount namespaces; it is still demonstrated by test N1, not assumed.
- **Slice nesting.** `cape-vault.slice` (and the probe's `cape-probe.slice`) is, by systemd's dash rule, a child of an implicit `cape.slice` under the root cgroup, not of `system.slice`. The `cpu`, `memory` and `pids` controllers must therefore be enabled through the root and `cape.slice`; probe M1 reads `cape.slice/cgroup.subtree_control` and stops if a controller is missing (a missing controller means silently absent limits). Cgroup paths in the acceptance document use `/sys/fs/cgroup/cape.slice/cape-probe.slice/…`.
- **About five daily users** supports Tier 0 (web only) and makes Tier 2 unnecessary for staging; nothing here claims capacity.
- **A stop-semantics risk is now explicit** (acceptance N8c): `--kill-child` is a parent-death signal that the kernel clears when `setpriv` changes credentials, and `KillMode=mixed` signals only the main PID (`unshare`). Whether SIGTERM reaches the Node namespace init is **UNTESTED**; the probe tests it with a control and carries a gated `KillMode=control-group` fallback.

## 2. Resolving `PrivatePIDs=yes` on systemd 255 (blocker S1)

**Fact.** `PrivatePIDs=` first exists in systemd 257. systemd 255 silently ignores it as an
unknown key, so the old templates would have started with no PID namespace; only the
PID-1 check in `service-entry.mjs` stopped them. They could never have run on this host.

**Why the namespace matters.** `cape-vault-web` and `cape-vault-scanner` deliberately share
UID `cape-vault-storage` (storage requires matching UID with 0700/0600). `ProtectProc=invisible`
hides only _other_ UIDs, so it does not separate them: a same-UID sibling can read
`/proc/<pid>/environ` and traverse `/proc/<pid>/root/run/credentials/...`. A real PID
namespace is the load-bearing boundary. Not accepted as substitutes: removing the directive,
`ProtectProc` alone, `hidepid` (same-UID), Yama ptrace scope (does not cover `environ`/`root`), a shared PM2 daemon.

**Chosen design (new, UNTESTED on the host):** a small root-owned launcher,
[`ops/libexec/cape-vault-ns-launch.example`](../ops/libexec/cape-vault-ns-launch.example), started by
`ExecStart=!` in each unit:

1. systemd first builds the unit's mount sandbox (`ProtectSystem=strict`, `InaccessiblePaths`,
   `ReadOnlyPaths`, `PrivateTmp`, `PrivateDevices`, credentials, `RuntimeDirectory`).
2. Stage 1 (root, only `CAP_SYS_ADMIN CAP_SETUID CAP_SETGID CAP_SETPCAP`) runs
   `unshare --pid --fork --kill-child=SIGTERM --mount --propagation private`.
3. Stage 2 is PID 1 of the new namespace: mounts a fresh `/proc` with
   `hidepid=invisible,subset=pid`, then `setpriv` switches to the service UID/GID, clears
   supplementary groups, empties bounding/inheritable/ambient capability sets and sets
   `no_new_privs`, and executes the pinned Node 24 running `scripts/service-entry.mjs`.
4. `service-entry.mjs` (now hardened, LOCAL-tested parser) refuses to continue unless it is
   PID 1, non-root, has all five capability sets empty, `NoNewPrivs=1` and a `/proc` listing
   containing only PID 1. It then does what it already did: scoped credentials, `execve` to
   the real process, which stays PID 1.
5. `RestrictNamespaces=pid mnt` (seccomp) stops the service creating further namespaces.

**Why `!` and not `+` (correction of revision 1).** Revision 1 proposed `ExecStart=+`. Per
`systemd.service`, `+` runs the command with full privileges _outside_ the unit's filesystem
namespacing, so `InaccessiblePaths=/etc/cape-vault/secrets` and `ReadOnlyPaths` would not
apply to the root shim and the secrets directory would be readable by it. `!` skips only
`User=`/`Group=` switching; all other sandbox options (including the capability bounding set and
`NoNewPrivileges`) still apply. This is **ASSUMED from documentation** and is acceptance test C1, which also
runs the `+` variant as a negative control.

**Known residual risks, to be accepted or rejected by the owner after tests:**

- A root-run shim exists for milliseconds with `CAP_SYS_ADMIN`; it is ~25 lines of POSIX shell, root-owned, immutable, with
  no network, no input parsing beyond two fixed arguments. Mitigated by the minimal bounding set and by `service-entry` proving the drop.
- The outer `unshare` process remains in the host PID namespace as the unit's main PID. Stop semantics depend on `--kill-child=SIGTERM`
  forwarding SIGTERM to Node-as-PID-1 (test N8). Fallback `KillMode=control-group` is documented.
- An untested kernel/AppArmor interaction on 6.8 (`mount` of procfs, nested mount namespaces) could block stage 2. The failure mode is a
  failed launch (fail-closed), never a weaker start.
- Web and scanner still share one UID. The PID namespace stops process/credential snooping between them, but a compromised web process keeps write access to the
  storage tree it legitimately owns; the scanner's read-only mount and adapter rejection are the control in the other direction.

**LOCAL evidence only:** `unshare --user --map-root-user --pid --fork --mount-proc` shows a fresh `/proc` containing exactly PID 1
(a different, rootless path from production). The guard's parser has 8 passing unit tests; the launcher passes `shellcheck`; systemd 249's
`systemd-analyze verify` reports no unknown keys in the rendered units. None of these proves `!` semantics, nested mounts or stop behaviour on Ubuntu 24.04.

**Alternatives considered:** (A) upgrade systemd to 257 — a host-wide change affecting five applications, rejected here;
(C) separate scanner UID with ACL/group read — changes the reviewed storage ownership model, needs engineering and review, rejected for now;
`systemd-nspawn`/containers/shared PM2 — rejected by project rules; rootless `unshare --user` — blocked by Ubuntu 24.04's default restriction on unprivileged user namespaces and
would remap UIDs against the storage ownership checks.

## 3. Storage, scanner and credential separation (preserved)

No change to the model. Web: `ReadWritePaths=/var/lib/cape-vault/objects`. Scanner: `ReadOnlyPaths=` plus the adapter's own write rejection.
Approval/reviewer: distinct UIDs and `InaccessiblePaths=` of objects. All units hide `/etc/cape-vault/secrets` and every sibling
`/run/credentials/<unit>`; each gets only its own `LoadCredential` files (web `database-password`, `auth-secret`; scanner `database-password`, `bouncer-key`;
approval `database-password`; reviewer `database-password`, `auth-secret`). Email drop-ins stay uninstalled; `EMAIL_PROVIDER=disabled`. Operator
credential never in a service. Verification: acceptance sections 3 and 4.

## 4. Dedicated Node 24 runtime (no change to global Node 22)

- Install the official Node 24 tarball (≥ 24.12, < 25; check SHA-256 from `SHASUMS256.txt` and its signature) under a version-pinned, root-owned
  directory such as `/opt/cape-vault/runtime/node-v24.X.Y-linux-x64/`. The launcher holds the exact path (`NODE=`); units no longer name any
  Node. No apt/NodeSource, no `nvm`, no PATH or `update-alternatives` change, no symlink at `/usr/bin` or `/usr/local/bin`.
- The global Node 22.23.2 and its npm are never touched; other applications' environment cannot see the new directory.
- Operator maintenance commands use the absolute pinned path (`/opt/cape-vault/runtime/…/bin/node scripts/db/production-maintenance.ts check`).
- The worker supervisor's `process.execPath` and `service-entry` therefore stay on the pinned runtime; `/usr/bin/flock` (util-linux) is
  still required (P3). Node 24's TypeScript type stripping runs the `.ts` scripts directly.
- Upgrades: extract a new pinned directory beside the old one, change `NODE=`, restart, keep the old one for rollback; delete after acceptance.
- Assumed available but untested on the host: `process.execve` (experimental); test N7.

## 5. Is Bun needed on the VPS?

**No.** Bun is an install/build tool (`bun install --frozen-lockfile`, `bun run build`; the lockfile needs ≥ 1.4.4). Runtime, maintenance and
workers invoke only `node` (`.output/server/index.mjs`, `scripts/service-entry.mjs`, `scripts/worker-loop.mjs`,
`scripts/db/production-maintenance.ts`; no `bun` reference in them). Build off-server, ship an immutable root-owned artifact with
production-only `node_modules` and the reviewed script import tree (now also `scripts/namespace-guard.mjs`). The build must target the
host architecture (x86_64 assumed; confirm P1); a build on an older glibc runs on 24.04's 2.39. Dev-only native packages
(lightningcss, rolldown, oxide) are not runtime dependencies and must not be shipped. Installing Bun on the VPS would add an unreviewed
runtime and download surface and is not recommended.

## 6. Process count and memory budget on a shared 4 GiB host

**Process count.** The namespace shim adds one resident `unshare` process (~1–2 MiB RSS, ASSUMED) per unit.

| Tier (scope)                                                               | Services running | Processes (idle → peak)                        |
| -------------------------------------------------------------------------- | ---------------- | ---------------------------------------------- |
| **0 — web only** (recommended; synthetic staging)                          | web              | 2 (unshare + Node)                             |
| 1 — tier 0 plus a brief scanner start for isolation tests (no Bouncer key) | web, scanner     | 4, only during tests                           |
| 2 — all four (not approved on this host)                                   | web + 3 loops    | 8 idle → 11 (each loop's batch child adds one) |

Thread counts count toward `TasksMax`. Each Node process uses ~10–15 threads, so a loop (parent plus batch child) can exceed the old
`TasksMax=32`; units now use 48 and the slice 64 (tier 0) / 160 (tier 2). Test M4 records the real figure.

**Memory (initial review values, not capacity claims).** Revision 1 finding R1 (web heap equal to `MemoryHigh`) is fixed: heap 256 MiB with
`MemoryHigh` 448 M; the worker heap is now 96 MiB because the parent and the batch child both inherit `NODE_OPTIONS`.

| Unit     | Heap cap | MemoryHigh / Max | CPU quota | Swap |
| -------- | -------- | ---------------- | --------- | ---- |
| web      | 256 MiB  | 448 M / 576 M    | 75 %      | 0    |
| scanner  | 96 MiB   | 224 M / 320 M    | 25 %      | 0    |
| approval | 96 MiB   | 160 M / 224 M    | 15 %      | 0    |
| reviewer | 96 MiB   | 160 M / 224 M    | 15 %      | 0    |

Slice, tier 0 (shipped): `MemoryHigh` 512 M, `MemoryMax` 640 M, 75 % CPU, no swap. That is ≈ 26 % of the 2.5 GiB available at
inspection, leaving ≈ 1.86 GiB for the neighbours. Tier 2 (sum of unit maxima 1,344 M; slice 1,280 M) would use ≈ 51 % of the same
snapshot and is **not recommended on this host** unless peak-period measurements keep `MemAvailable` ≥ 2.5 GiB with five applications
running and `kbsk-staging` accounted for; the owner has not stated whether it returns.
All units add `CPUWeight=20`, `IOWeight=20`, `OOMScoreAdjust=500`, `MemorySwapMax=0` and `LimitCORE=0` (R2: our processes lose CPU contention
and are the OOM victim; no swap pressure on shared swap; no core dumps containing secrets). **`IOWeight=20` is expected to be inert on this host** (no `io`
controller, §1); it is harmless but gives no protection. Whether to delete it from the templates is an owner decision after probe I1–I2; the probe units omit it.

Open measurement dependencies: neighbours' peak (not 'one snapshot'); PostgreSQL 16's resident footprint (`systemd-oomd` is inactive, verified).
Because 2 vCPU is shared, `CPUQuota=75 %` of the slice is also a ceiling, not a guarantee, so M3 compares neighbour latency during load.

## 7. Template and code changes made in this revision (all inactive)

- `ops/libexec/cape-vault-ns-launch.example` (new launcher).
- Four unit templates: `ExecStart=!` launcher; `PrivatePIDs=yes` removed; `CapabilityBoundingSet=CAP_SYS_ADMIN CAP_SETUID CAP_SETGID CAP_SETPCAP`
  (launcher-only, dropped before Node); `RestrictNamespaces=pid mnt`; resource-control block above; `LimitCORE=0`. Node path now lives only in
  the launcher (pinned directory; never `/usr/bin/node`).
- `cape-vault.slice.example`: tier 0 values with the tier 2 note; environment templates: web heap 256, workers 96.
- `scripts/namespace-guard.mjs` + `scripts/namespace-guard.test.mjs` (8 tests, `bun run test:namespace-guard`); `scripts/service-entry.mjs` calls them
  before reading any credential. No migration, audit, RLS, grant, storage or notification code changed.
- Not changed: PostgreSQL socket arrangement (P1), `pg_hba`, Nginx templates, database target, email drop-ins.

## 8. Ready / needs testing / owner approval

**Ready (repository):** launcher and units drafted; guard code and unit tests; budgets and tiers; acceptance suite; rollback; Bun/Node decisions.

**Needs host testing before any exposure (nothing demonstrated; prepared as the temporary probe in [the acceptance document](phase-5a-host-acceptance-tests.md), awaiting approval):** `!` retains the mount sandbox (C1); namespace creation and fresh `/proc` on kernel 6.8 (N1–N4);
negative controls (N5, C1 with `+`); stop and restart semantics (N8, N9); `process.execve` (N7); read-only storage and mount modes (S2); cgroup controller delegation,
OOM, CPU and task limits (M1–M5); pinned Node install; PostgreSQL socket and `pg_hba` approach (P1/P2 from revision 1); resource behaviour over 24–48 h.

**Owner approvals required (nothing implied by this document):** each of the following separately: (1) running the read-only inspection in §9 (and which privileged lines);
(2) installing the pinned Node 24 tree and the launcher under `/opt/cape-vault`; (3) creating the probe harness under `/run` and running the probe (acceptance document §1 lists every change: 8 unit files, two `daemon-reload`s, UID `nobody`, capped CPU/memory/PID stress inside `cape-probe.slice`, one deliberate cgroup OOM kill); (4) creating real users, directories, units and the slice; (5) PostgreSQL roles/database/socket/`pg_hba` reload;
(6) Nginx/DNS/TLS and staging access restriction; (7) resource tier, window and rollback window, and an answer on `kbsk-staging`; (8) synthetic-account seeding procedure (blocker S2, unchanged);
(9) accepting the residual risks in §2. External email, Bouncer and PDFs remain separately gated and are out of scope.

## 9. Remaining read-only inspection (the host probe's G0 preconditions P1–P10 cover most of this list)

`uname -m`; the root `cgroup.controllers`/`cgroup.subtree_control` (the `system.slice` list is verified); `/proc/sys/user/max_{pid,mnt}_namespaces`;
`unshare --version; setpriv --version; command -v flock mount`; `sysctl kernel.yama.ptrace_scope fs.protected_hardlinks kernel.apparmor_restrict_unprivileged_userns`;
how the five applications are supervised (unit names / PM2 owner user, names only) and which Linux users they run as (names only, for storage-isolation test S4); `ps -e --no-headers | wc -l` and
RSS of the top 15 processes by name at the neighbours' peak (several samples over a business day, `MemAvailable` and PSI each time); PostgreSQL version, `max_connections`, socket directory and cluster list
(`pg_lsclusters`; privileged lines from revision 1 Appendix A); Nginx vhost listener summary and `nginx -t` (privileged); `df`/`df -i` of the filesystem that will hold `/var/lib/cape-vault`;
`journalctl --disk-usage`; whether `kbsk-staging` returns and its RSS; collision checks for `cape*` users/paths/units/roles and the unused port 3300 (reconfirm immediately before provisioning).
Never run `ps` with arguments, `pm2 env/describe/jlist`, `nginx -T`, `systemctl cat`, or read `/proc/*/environ`.

## 10. Synthetic-only staging restrictions (unchanged)

`EMAIL_PROVIDER=disabled`; no Resend key; no Bouncer key; scanner and mail loops stopped (scanner started only for the namespace tests, without a key); no PDFs; no real clergy or
resources; no production administrator bootstrap; no development data or secrets copied; no confidential route. The initial staging cannot claim PDF, mail or scanning acceptance.
Blockers S2 (no reviewed way to create synthetic accounts), S3 (restricted vhost), S4 (DNS/TLS) and S5 (historical development records) from revision 1 are unchanged.

## 11. Decision

**NOT YET CONDITIONAL GO.** The design is now compatible in principle with Ubuntu 24.04/systemd 255 and no security directive was dropped (the PID namespace is replaced, not removed), but its
central controls are untested on the host. It becomes **CONDITIONAL GO for Tier 0 web-only synthetic staging** when the §9 inspection shows no collision and sufficient peak headroom, the owner approves §8 items 1–3
and 7, the section 2–5 acceptance tests (including both negative controls) pass, and blocker S2 is resolved or staging is accepted as navigation-only. If any isolation test fails, follow the rollback in the
acceptance document; do not weaken the sandbox.
