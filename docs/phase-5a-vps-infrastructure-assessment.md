# Phase 5A — VPS infrastructure assessment (read-only preflight)

Prepared 17 November 2026. **Status: repository review complete; VPS inspection NOT
performed.** No authorised SSH connection was supplied, so no host was contacted and
no SSH key, credential, shell history or unrelated configuration file was searched.
Every host fact below is marked `NOT INSPECTED` until the owner returns the Appendix A
output. Nothing was installed, changed, committed or deployed.

## 1. Source revision reviewed

| Item               | Value                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| HEAD               | `c0eecfea1c3925a22a275313baf80af497f7b303` ("Style signed-out home page buttons as proper buttons")                                       |
| Checked-out branch | `main`. The brief names `feat/self-hosted-migration`; local and `origin` copies of **both** branches resolve to the same commit.          |
| Working tree       | Clean before this work. This assessment and the Phase 5B plan are the only new, untracked files.                                          |
| Documents read     | AGENTS.md, phase-431 report, phase-5 preflight, production architecture/roles, worker-supervision, backup-recovery, release-readiness     |
| Templates read     | `ops/systemd/*` (4 units, slice, 3 email drop-ins), `ops/*.environment.example`, nginx, pg_hba, provisioning SQL, target JSON, PM2 sample |
| Code read          | `scripts/service-entry.mjs`, `scripts/worker-loop.mjs` (execve/flock lines), `scripts/db/production-maintenance.ts`, auth register path   |
| Staleness noticed  | `release-readiness.md` still says 0039 is pending; the owner reports it is applied locally. Local-only; does not affect the VPS.          |

## 2. Inspection scope and limitations

- **Performed:** local repository/documentation review only.
- **Not performed:** every VPS check (sections 3–7 are placeholders plus offline analysis).
- **Consequence:** I cannot say whether the VPS can host the application. The decision in section 15 is therefore **NO-GO pending evidence**, not a finding that the host is unsuitable.
- Offline conclusions below are about the _templates_; where I cite Ubuntu/systemd versions I am relying on recollection of distribution defaults and they must be confirmed by the host output.

## 3. VPS operating system and software versions — NOT INSPECTED

| Item                                    | Required / expected                                     | Observed                |
| --------------------------------------- | ------------------------------------------------------- | ----------------------- |
| Ubuntu release, kernel, architecture    | any with systemd ≥257 (see §6)                          | pending                 |
| systemd                                 | **≥257** for `PrivatePIDs=yes`                          | pending                 |
| Virtualisation (`systemd-detect-virt`)  | `kvm`/full VM. LXC/OpenVZ may lack namespaces/cgroups   | pending                 |
| cgroup version / controllers            | cgroup v2 with `memory`, `cpu`, `pids`                  | pending                 |
| Node.js                                 | 24.12+ (<25) with `process.execve`, at an approved path | pending                 |
| Bun (build only; not needed on the VPS) | 1.4.4+                                                  | pending                 |
| PostgreSQL server / client / `pg_dump`  | supported major; client ≥ server major for backup       | pending                 |
| Nginx                                   | any current; `nginx -t` must pass                       | pending                 |
| `flock` (util-linux)                    | `/usr/bin/flock` (hard-coded in `worker-loop.mjs`)      | pending                 |
| PM2                                     | **not used** by the new design                          | pending (informational) |

## 4. Resource measurements — NOT INSPECTED

Total RAM, `MemAvailable`, swap, load average, PSI memory/CPU pressure, top resident
consumers (by name and RSS only), PostgreSQL resident footprint, disk and inode free
space, process counts and existing Node/PM2 workloads are all pending. **Installed RAM
is not treated as free capacity.** Use the peak-hour `MemAvailable`, not an idle snapshot.

### Proposed budget versus the templates (offline analysis)

| Service  | `MemoryHigh` / `MemoryMax` | Node heap cap | CPU quota | Notes                                             |
| -------- | -------------------------- | ------------- | --------- | ------------------------------------------------- |
| web      | 384 M / 512 M              | 384 MiB       | 75 %      | See finding R1                                    |
| scanner  | 192 M / 256 M              | 128 MiB       | 25 %      | Two Node processes while a batch runs             |
| approval | 144 M / 192 M              | 128 MiB       | 15 %      | Two Node processes while a batch runs             |
| reviewer | 144 M / 192 M              | 128 MiB       | 15 %      | Two Node processes while a batch runs             |
| **Sum**  | 864 M / **1,152 M**        |               | **130 %** | Slice: 1 G high / 1,536 M max / 130 % / 128 tasks |

Findings:

- **R1 — web heap equals `MemoryHigh`.** A 384 MiB V8 heap plus ~80–150 MiB of non-heap memory exceeds 384 M `MemoryHigh`, so the kernel would throttle/reclaim the web process well before the heap limit. Either lower the web heap to ~256 MiB or raise `MemoryHigh` to ~448 M; decide from measured RSS.
- **R2 — nothing protects neighbours.** The slice caps CPU with `CPUQuota` but sets no `CPUWeight`/`IOWeight`/`OOMScoreAdjust`. Under contention our processes compete at default weight and the OOM killer may pick another application. Proposed review additions: `CPUWeight=20`, `IOWeight=20`, `OOMScoreAdjust=500` on every unit, and `MemorySwapMax=0` for the slice unless swap is plentiful.
- **R3 — worker memory is plausible but unmeasured.** Seven Node processes at ~40–60 MiB baseline is ≈ 350 MiB before heaps. Measure real RSS in staging before accepting the 1.5 GiB figure.
- **R4 — the 130 % ceiling is a cap, not a guarantee.** On 2 vCPUs it leaves 70 % for neighbours only when we are saturated; it is acceptable only if neighbours' measured peak load fits in that remainder.

### Recommended initial budget (tiers; apply the first tier whose gate the measurements satisfy)

Gates use **peak-period `MemAvailable` after existing workloads**, with no sustained swap-in and PSI `some avg60 < 5 %`.

| Tier | Scope                                                              | Slice `MemoryMax` | CPU cap | Required `MemAvailable`        | Required free disk        |
| ---- | ------------------------------------------------------------------ | ----------------- | ------- | ------------------------------ | ------------------------- |
| 0    | **Web only** + dedicated DB, synthetic, no workers                 | 640 M             | 75 %    | ≥ 1.0 GiB                      | ≥ 5 GiB and ≥ 50 k inodes |
| 1    | Tier 0 + scanner/approval/reviewer units installed but **stopped** | 640 M             | 75 %    | ≥ 1.0 GiB                      | same                      |
| 2    | All four services running (the full template)                      | 1,536 M           | 130 %   | ≥ 2.0 GiB (1.5 + 0.5 headroom) | ≥ 10 GiB                  |

These thresholds are my proposals for owner review, not measured capacity claims. If
Tier 0 fails, **stop**; do not squeeze the application in at the neighbours' expense.

## 5. Existing application impact assessment — NOT INSPECTED

Inventory required (names/ports/sizes only, never contents): Nginx vhosts and listeners,
existing app processes and managers (systemd/PM2/other), listening TCP/Unix sockets,
PostgreSQL clusters/databases, timers/cron names, backup arrangements, `/var/log` growth
and logging/monitoring tools. Risk areas already visible from the templates:

| Shared resource     | How Cape Vault touches it                                       | Risk and mitigation                                                                                    |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Nginx               | New vhost + one `log_format` in `http` context + reload         | A bad config breaks all sites. Needs `nginx -t`, backup of config, authorised reload. No global edits. |
| PostgreSQL          | New DB, four roles, `pg_hba` rules, reload; possibly socket dir | `pg_hba` ordering and `PUBLIC CONNECT` on other DBs. Reload (not restart) only, with DBA approval.     |
| `/usr/bin/node`     | Units hard-code it                                              | **I1** below: installing Node 24 system-wide may change other apps' runtime.                           |
| CPU/RAM/IO          | New slice                                                       | R2–R4 above.                                                                                           |
| Disk/inodes/journal | Objects, release dirs, journald, Nginx logs                     | Journal retention is global; do not change it. Use app-specific logrotate only.                        |
| Ports               | 3300 loopback                                                   | Collision check pending.                                                                               |
| Firewall            | None needed (Nginx 443 only)                                    | Do not open 3300 externally.                                                                           |

## 6. systemd and namespace compatibility

**Verdict: probably incompatible on a stock Ubuntu 22.04/24.04 host; confirm with Appendix A.**

- Ubuntu 22.04 ships systemd 249 and 24.04 ships 255 (recollection; verify). `PrivatePIDs=` first appears in systemd **257**. On an older systemd the directive is reported as an unknown key and **ignored**; the unit still starts.
- That silent downgrade is caught: `scripts/service-entry.mjs` throws unless `process.pid === 1`, so an unsupported host produces a **failed launch** (restart-limited by `StartLimitBurst=3`/300 s), not weakened isolation. This is the intended fail-closed behaviour and is verified by reading the code, not by running it on a host.
- **Why it matters here:** web and scanner share UID `cape-vault-storage`. `ProtectProc=invisible` hides only _other-UID_ processes, so it does **not** separate them. The PID/mount namespace is the load-bearing boundary for web ⇄ scanner `/proc` isolation. Do not accept any substitute that lacks it for the combined web+scanner case.
- `LoadCredential`, `InaccessiblePaths`, `ReadOnlyPaths`, `ProtectSystem=strict`, `RuntimeDirectory` and `PrivateMounts` exist in systemd ≥250 and are not the blocker. `LoadCredential` requires a root-readable source and a per-service credentials mount; the `/run/credentials/<unit>` path in `service-entry.mjs` matches systemd's convention.
- **Node `process.execve`:** present in the 24.x line used by the repo (24.12.0 locally) but flagged experimental upstream. It is untested on the host and there is no spawn fallback by design. Must be proven by Appendix B tests.
- **PID 1 in a namespace:** Node as PID 1 receives only signals it has handlers for and does not reap orphans. Direct children (batch children, `flock`-held loops) are reaped by their parent; acceptable, but SIGTERM/SIGINT handling and the 190 s drain must be exercised.

### Options if systemd < 257 (none implemented; each needs owner review)

| Option                                                                                                                                                                                                  | Mechanism                                                         | Security trade-off                                                                                                                                                                                     | Cost                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **A. Upgrade systemd** to ≥257 (e.g. newer Ubuntu, or a vendor backport)                                                                                                                                | Native directive                                                  | Cleanest. Highest blast radius: a host-wide OS/init change affecting every app.                                                                                                                        | Requires explicit owner decision and a host-wide change window. **Not recommended on a shared VPS.** |
| **B. Root-owned launcher using `unshare`** (`ExecStart=+` runs `unshare --pid --fork --mount-proc --kill-child`, then `setpriv` drops to the service UID with an empty bounding set and `no_new_privs`) | Same PID-1 property satisfied by `service-entry.mjs` unmodified   | Adds a small root-run shim that must be reviewed and kept minimal; remaining sandbox directives still come from systemd. Mount-namespace/`InaccessiblePaths` still applied by systemd before the shim. | Needs template change + tests proving `/proc` isolation and credential hiding. Preferred fallback.   |
| **C. Separate scanner UID** with a one-way file path (scanner reads objects through a separately reviewed read-only bind/ACL)                                                                           | Removes same-UID dependency                                       | Storage provider requires UID-matching 0700/0600; sharing needs a code/storage-design change. **Weakens the reviewed storage model** unless redesigned.                                                | Engineering work, new review.                                                                        |
| **D. Web-only staging (Tier 0)** with scanner/mail never started                                                                                                                                        | Same-UID sharing disappears because only one storage process runs | Valid for synthetic web-only preview, but `service-entry.mjs` still refuses without PID 1, so a launcher (Option B) or a reviewed code change is still needed.                                         | Smallest scope; does not exercise scanner isolation.                                                 |
| E. Docker/containers, shared PM2 daemon, group-readable objects                                                                                                                                         | —                                                                 | **Rejected** by AGENTS.md/preflight (shared secret domain, broader privileges, no socket exposure).                                                                                                    | —                                                                                                    |

No weaker option will be implemented without explicit owner review.

## 7. PostgreSQL readiness — NOT INSPECTED

Pending: server/client majors, `max_connections` and current usage, `shared_buffers`/
`work_mem`, data directory size and free disk, socket directory and permissions,
`pg_hba` structure, existing backup method, and whether `cape_*` names collide.
Targeted collision queries only (Appendix A, privileged): `rolname LIKE 'cape\_%'`,
`datname = 'cape_clergy_vault'`, aggregate connection count. No table enumeration, no
export, no role or database creation.

Offline findings about the prepared architecture:

- **P1 — fixed socket path.** `database-target.json` pins `/run/cape-vault/postgresql`. Stock Ubuntu PostgreSQL listens on `/var/run/postgresql`. Reaching the pinned path needs one of: (a) change `unix_socket_directories` — a **PostgreSQL restart affecting every database**, not acceptable without a window; (b) a second dedicated cluster — extra RAM (~100–200 MiB) and another service to back up; (c) a per-unit `BindReadOnlyPaths=/var/run/postgresql:/run/cape-vault/postgresql` so the existing socket appears at the pinned path inside the sandbox — no PostgreSQL change, but the sandbox can then see other clusters' sockets (still gated by `pg_hba`/roles). Recommendation: option (c) subject to owner review, else (b). The alternative `transport=tls` target needs a CA file, valid hostname and a TLS-enabled PostgreSQL listener, which is also a server change.
- **P2 — `pg_hba` reload.** Application rules must precede generic rules, then `pg_reload_conf()` (a reload, not restart) on the shared server. DBA authorisation required. Review the Ubuntu default `local all all peer` ordering before inserting.
- **P3 — connections.** Budget is 8 service connections + 1 operator + 1 backup. Confirm `max_connections − current peak ≥ 12`.
- **P4 — owner role name.** `cape_clergy_dev` is intentionally retained for the production owner. It must be created fresh with a new password; if the name already exists on the host, **stop**.
- **P5 — backup.** `pg_dump --format=custom` of one database is feasible and does not interfere with others; client major must be ≥ server major. Off-host destination and key custody are undecided (Diocese register).
- **P6 — growth.** Synthetic staging growth is negligible; capacity numbers need real usage and are not claimable.

## 8. Port and path collision assessment — NOT INSPECTED

| Proposed value                                                                                                | Check                                         | Result  |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------- |
| TCP 3300 (loopback)                                                                                           | not listening; not used by any proxy upstream | pending |
| Database `cape_clergy_vault`                                                                                  | absent                                        | pending |
| Roles `cape_clergy_{dev,runtime,scanner,notifications}`                                                       | absent                                        | pending |
| `/srv/cape-vault`, `/var/lib/cape-vault`, `/etc/cape-vault`, `/var/backups/cape-vault`, `/var/log/cape-vault` | absent, or empty and ours                     | pending |
| Users `cape-vault-{storage,approval,reviewer}`; slice `cape-vault.slice`; units `cape-vault-*`                | absent                                        | pending |
| `/run/cape-vault/*`                                                                                           | absent                                        | pending |
| Hostname/DNS and certificate                                                                                  | owner-chosen; no existing vhost conflict      | pending |

Any collision is a stop condition; names are not reused or adapted without owner approval.

**I1 — `/usr/bin/node`.** The four unit templates execute `/usr/bin/node`. Ubuntu's repositories do not carry Node 24, so a system-wide install would replace or shadow the runtime other apps may depend on. Proposal for review: install Node 24.12+ from the official tarball to a root-owned, version-pinned path such as `/opt/cape-vault/node-v24.x/bin/node`, change `ExecStart=` in the cape-vault units only, and leave `/usr/bin/node` untouched. `service-entry.mjs` uses `process.execPath`, so it needs no code change; `worker-loop.mjs` calls `/usr/bin/flock` (util-linux, standard).

## 9. Web / worker / storage isolation feasibility

Assessed from the templates against the stated requirements (not tested on any host):

| Requirement                                            | Template mechanism                                                                | Feasible on host?                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| Web storage read/write only to its own mount           | `ReadWritePaths=/var/lib/cape-vault/objects`, `ProtectSystem=strict`              | Yes (any systemd ≥250)                            |
| Scanner storage read-only                              | `ReadOnlyPaths=`; storage adapter independently rejects writes                    | Yes                                               |
| Web ⇄ scanner `/proc` and secret separation (same UID) | `PrivatePIDs=yes` + `PrivateMounts` + per-unit `LoadCredential`                   | **Only with PID ns (systemd ≥257 or Option B)**   |
| Mail workers cannot read PDFs                          | Distinct UIDs; `InaccessiblePaths=/var/lib/cape-vault/objects`                    | Yes                                               |
| Services don't see each other's secrets                | Root-owned `/etc/cape-vault/secrets` hidden; sibling credential dirs inaccessible | Yes                                               |
| Operator credentials outside runtime                   | Operator mount absent from every unit                                             | Yes (operational discipline)                      |
| Other VPS apps can't read private files                | 0700/0600 owned by the storage UID; parent dirs root-owned                        | Yes provided no neighbour runs as root-equivalent |
| No shared PM2 daemon                                   | systemd units only                                                                | Yes                                               |

Residual: another application running as root, or any user with `sudo`, can read everything; that is outside this boundary and should be disclosed to the owner.

## 10. Recommended initial RAM and CPU budgets

See §4 tiers. **Initial recommendation: Tier 0** (web + DB, 640 M, 75 % CPU) for synthetic
staging, and move to Tier 2 only after the owner supplies measurements meeting its gate.
Add R1/R2 changes to the templates before any install. This remains a recommendation
until section 4 is populated from the host.

## 11. Security blockers

| ID  | Blocker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Effective PID/mount isolation unproven; templates require systemd ≥257 and Node `execve` on the host.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| S2  | **No reviewed production path to seed synthetic accounts.** `production-maintenance.ts` offers only `check`, `migrate`, `grants`; bootstrap/seed scripts are local-only. With `EMAIL_PROVIDER=disabled`, registration can create accounts but verification mail cannot be delivered, and approval/consent states cannot be reached. Synthetic-account workflows are therefore **not currently achievable** without a new, reviewed, owner-authorised seeding procedure (engineering item for Phase 5B-prep). No production administrator bootstrap is permitted. |
| S3  | Public registration endpoint would be internet-reachable. For staging restrict the vhost (IP allowlist and/or Nginx basic auth) until the owner decides otherwise.                                                                                                                                                                                                                                                                                                                                                                                               |
| S4  | TLS certificate/DNS name not chosen. No plaintext HTTP exposure of auth cookies.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| S5  | The two historical confidential development PDF records with provider IDs remain an open responsible-party matter; **no development data or database is to be copied to the VPS.**                                                                                                                                                                                                                                                                                                                                                                               |

## 12. Infrastructure blockers

| ID  | Blocker                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | Host not inspected: OS, systemd, resources, collisions and PostgreSQL facts unknown (this document).                                                                                  |
| N2  | Node 24.12+ runtime not available at an approved non-colliding path (I1).                                                                                                             |
| N3  | PostgreSQL socket path decision (P1) and `pg_hba` reload approval (P2).                                                                                                               |
| N4  | Nginx include for `log_format` and a vhost, DNS and certificate approvals.                                                                                                            |
| N5  | Resource budget not grounded in measurements (R1–R4).                                                                                                                                 |
| N6  | Backup destination, key custody and retention undecided; staging data is synthetic so this blocks real data only, but a restore/rollback plan for the _dedicated DB_ is still needed. |

## 13. Items requiring explicit owner authorisation

1. Running Appendix A read-only commands on the VPS (and any privileged item, listed separately there).
2. Installing Node 24 under `/opt/cape-vault/` (or the chosen path).
3. Creating Linux users/groups and the slice, directories and systemd units.
4. Creating PostgreSQL roles/database; choosing socket option (a)/(b)/(c); `pg_hba` edit and reload.
5. Nginx include/vhost/reload, DNS record, certificate issuance, and staging access restriction.
6. Chosen isolation path if systemd < 257 (Option A/B/C/D) and any template change (R1, R2, I1).
7. A reviewed synthetic-account seeding procedure (S2).
8. Resource tier and rollback window. Separately: any external email or Bouncer test (out of scope for the first stage).

## 14. Concrete Phase 5B installation sequence

Summary (full prerequisites, validation, stop conditions and rollback are in
[phase-5b-staging-execution-plan.md](phase-5b-staging-execution-plan.md)):

0. Owner runs Appendix A; this assessment is completed and the GO/NO-GO re-decided.
1. Repository prep (local, no host): template changes R1/R2/I1/P1; decide S2; tag release; build artifact on a workstation.
2. Owner authorises exact names/paths/ports/tier/window.
3. Install Node 24 to a private path and verify `execve`, `flock`.
4. Create users, directories, slice; install units **stopped**.
5. Provision DB/roles; `pg_hba`; reload; verify isolation.
6. Place root-owned target file and credentials.
7. Deliver release; run operator `check`; with maintenance approval `migrate`, `grants`, `check`.
8. Namespace/credential/storage-isolation tests with the service stopped-then-started web only.
9. Nginx vhost (restricted), TLS, health probes.
10. Synthetic walkthrough; resource observation 24–48 h; decide tier change or teardown.

## 15. Decision for synthetic staging

**NO-GO (evidence missing).** Reasons: the host has not been inspected, the prepared
isolation requires systemd ≥257 that a stock Ubuntu LTS is unlikely to have, and
there is no reviewed way to create usable synthetic accounts in production mode.

It becomes **CONDITIONAL GO for Tier 0 web-only synthetic staging** when all hold:

- Appendix A shows no name/port/path collisions and the Tier 0 resource gate is met.
- Either systemd ≥257 with working PID namespaces, or the owner approves Option B and its tests pass.
- Node 24.12+ is installed at a non-colliding path and `execve` works.
- The socket option (P1) and `pg_hba` reload are authorised.
- A seeding procedure for synthetic accounts is reviewed (S2), or the owner accepts a navigation-only preview.

It does **not** unlock: real clergy, real resources, live Resend, Bouncer, PDF scanning,
confidential material or any production claim.

### Workflows in initial staging mode (email disabled, no scanner, no PDFs)

| Works                                                                                                           | Does not work / disabled                                                |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Public pages, navigation, CSP/headers, `/health/live`, `/health/ready` (will report `degraded`: scanner absent) | Email verification, password reset, approval and reviewer notifications |
| Sign-in for **pre-provisioned verified** synthetic accounts, if S2 is solved                                    | Self-service registration to a usable account (cannot verify)           |
| Role-gated pages and RLS behaviour for seeded synthetic roles                                                   | Reviewer invitation activation (needs mailbox proof delivery)           |
| Idea/text submissions without attachments                                                                       | PDF upload, scanning, download of documents                             |
| Operator `check` audits, restart/reboot behaviour of web                                                        | Anything confidential, any real provider, mail loops, scanner loop      |

---

## Appendix A — Read-only commands for the owner

Run on the VPS as an ordinary unprivileged user over the already-authorised connection.
Redact nothing automatically; none of these print environment values, command-line
arguments, credentials or file contents. **Return the complete output.** Do not paste
anything from `ps` with arguments, `pm2 env/describe/jlist`, `nginx -T`, `systemctl cat`
or `/proc/*/environ`.

```sh
# --- Identity, OS, virtualisation
date -u; hostnamectl --static
. /etc/os-release; echo "$PRETTY_NAME"; uname -srm
systemctl --version | head -1
systemd-detect-virt
stat -fc 'cgroup fs: %T' /sys/fs/cgroup; cat /sys/fs/cgroup/cgroup.controllers
cat /proc/sys/user/max_pid_namespaces /proc/sys/user/max_mnt_namespaces 2>&1
ls /proc/self/ns

# --- Runtimes and tools (versions only)
command -v node && node -v; command -v bun && bun -v
ls -l /usr/bin/node 2>&1; command -v flock && flock --version | head -1
command -v pm2 && pm2 -v; nginx -v 2>&1
psql --version 2>&1; pg_dump --version 2>&1; pg_lsclusters 2>&1

# --- CPU / memory / pressure
nproc; lscpu | grep -E 'Model name|Architecture|Thread|Core|Socket'
grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree|Cached|Dirty' /proc/meminfo
free -m; swapon --show; uptime
cat /proc/pressure/memory /proc/pressure/cpu /proc/pressure/io 2>&1
vmstat 1 5
ps -eo rss,comm --sort=-rss | head -15          # names and RSS only, no arguments
ps -e --no-headers | wc -l
systemd-cgtop -b -n 1 -m 2>&1 | head -25        # cgroup paths, no arguments
journalctl --disk-usage 2>&1

# --- Disk and inodes
df -hT -x tmpfs -x devtmpfs; df -i -x tmpfs -x devtmpfs; lsblk
du -xsh /var/log 2>/dev/null

# --- Existing services, ports, timers (names only)
systemctl list-units --type=service --state=running --no-legend --no-pager | awk '{print $1}'
systemctl list-timers --all --no-legend --no-pager | awk '{print $NF}'
ss -ltn | awk '{print $1, $4}'
ss -lx 2>/dev/null | awk '{print $5}' | grep -i -E 'postgres|\.s\.PGSQL'
ls /etc/nginx/sites-enabled /etc/nginx/conf.d 2>&1
grep -rhE '^\s*(listen|server_name)\b' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null
ls /etc/cron.d /etc/logrotate.d 2>&1

# --- Collision checks (existence only)
ls -ld /srv/cape-vault /var/lib/cape-vault /etc/cape-vault /var/backups/cape-vault /var/log/cape-vault /run/cape-vault 2>&1
getent passwd | cut -d: -f1 | grep -i -E '^cape' ; getent group | cut -d: -f1 | grep -i -E '^cape'
systemctl list-unit-files --no-legend --no-pager | grep -i cape
ss -ltn | grep -E ':3300\b' || echo "3300 free"

# --- PostgreSQL filesystem facts (no login)
ls -ld /var/run/postgresql /etc/postgresql 2>&1

# --- Verify the template's directive support without running anything
# Copy ops/systemd/cape-vault-web.service.example to a scratch dir first (e.g. ~/scratch/x.service)
systemd-analyze verify ~/scratch/x.service 2>&1 | grep -i -E 'unknown|PrivatePIDs' || echo "no complaints"
```

### Privileged items (each needs your explicit authorisation; read-only)

| Command                                                                                                                                                            | Why                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `sudo -u postgres psql -Atc "SHOW server_version; SHOW max_connections; SHOW shared_buffers; SHOW work_mem; SHOW unix_socket_directories; SHOW listen_addresses;"` | version, capacity and socket location                                                              |
| `sudo -u postgres psql -Atc "SELECT count(*) FROM pg_stat_activity;"`                                                                                              | connection headroom (aggregate only)                                                               |
| `sudo -u postgres psql -Atc "SELECT rolname FROM pg_roles WHERE rolname LIKE 'cape\_%'; SELECT datname FROM pg_database WHERE datname='cape_clergy_vault';"`       | collision check; no other names                                                                    |
| `sudo -u postgres psql -Atc "SELECT pg_size_pretty(sum(pg_database_size(datname))) FROM pg_database;"`                                                             | total database footprint, no table listing                                                         |
| `sudo grep -nE '^\s*(local                                                                                                                                         | host)' /etc/postgresql/*/main/pg_hba.conf` (review output for secrets first; it normally has none) | rule ordering |
| `sudo ls -l /etc/nginx/nginx.conf /etc/nginx/sites-available` and `sudo nginx -t`                                                                                  | config validity before any change                                                                  |
| `sudo systemd-run --wait --pipe -p PrivatePIDs=yes sh -c 'echo $$'` — prints `1` if supported (creates only a transient unit, removed on exit)                     | actual proof of PID namespace support                                                              |

## Appendix B — Host tests to run in Phase 5B (not run now)

Namespace: from inside the stopped-then-started web sandbox, `/proc` lists only itself;
scanner (when later enabled) cannot open web credentials; `service-entry` reaches PID 1;
`process.execve` succeeds; restart and reboot preserve all of the above; an
unsupported-directive host fails the launch rather than starting weakened. Storage:
scanner writes fail, mail services cannot open objects, neighbours' UIDs cannot read
`/var/lib/cape-vault`. Credentials: other units' credential directories and
`/etc/cape-vault/secrets` return permission/ENOENT.
