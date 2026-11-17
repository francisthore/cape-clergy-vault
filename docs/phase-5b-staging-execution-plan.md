# Phase 5B — Synthetic staging execution plan (DO NOT EXECUTE)

Prepared 17 November 2026 alongside the
[Phase 5A assessment](phase-5a-vps-infrastructure-assessment.md). **This is a plan, not
authorisation.** Nothing here has been run. Every host-specific value (names, paths,
tier, versions, socket option) is a proposal until the owner confirms it in writing after
Phase 5A Appendix A has been completed and reviewed. Scope: synthetic data only, email
provider disabled, no Bouncer key, no PDFs, no real clergy, no production administrator
bootstrap, no reused development database or secrets. Other applications are never
modified except for the explicitly authorised Nginx include/reload and PostgreSQL
`pg_hba` reload, each with its own rollback.

## Global stop conditions (any one halts the plan; do not improvise around them)

- A name, port or path collides, or an existing resource would be altered unintentionally.
- Measured `MemAvailable`, disk or inode headroom falls below the chosen tier gate, or any neighbour shows degradation (latency, OOM, swap thrash, error logs) attributable to our work.
- Isolation cannot be demonstrated (namespace, credential, storage tests in Phase 5B-7).
- Owner/operator credentials would enter a service environment, shell history or process arguments.
- Database target/marker, role attributes or the applied-migration ledger do not verify.
- Any step needs a weaker permission, shared PM2 daemon, container socket, group-readable objects or a relaxed guard.
- Any real data, real mailbox, live Resend or Bouncer key is about to be used.
- A rollback step for the _previous_ step has not been written down and checked.

Each step below records: **Prereq → Action (authorised operator only) → Validate → Rollback.**
Record time, operator, approval reference and output for every step in an operator log
that contains no secrets.

---

## 5B-0 Gate: complete Phase 5A

- **Prereq:** owner ran Phase 5A Appendix A (and approved privileged items); output reviewed.
- **Action:** fill Phase 5A sections 3–8; choose tier (0 recommended); record the decision for systemd ≥257 or an isolation alternative (Option A/B/C/D); choose PostgreSQL socket option.
- **Validate:** no collisions; tier gate met; neighbours' peak load documented; owner signs the exact names/paths/ports/window/rollback window.
- **Stop:** any Phase 5A blocker still open. **Rollback:** none (read-only).

## 5B-1 Repository preparation (local workstation; no host contact)

- **Prereq:** 5B-0 approved; clean tree at the reviewed revision (record SHA).
- **Action (code/template changes, reviewed before use):**
  1. R1/R2: adjust web heap/`MemoryHigh`; add `CPUWeight`, `IOWeight`, `OOMScoreAdjust` (and slice swap policy).
  2. I1: parametrise or edit unit `ExecStart=` to the approved Node path (e.g. `/opt/cape-vault/node-v24.x/bin/node`).
  3. P1: add `BindReadOnlyPaths=` or chosen socket arrangement to units, if option (c); otherwise reviewed target file for option (b).
  4. If systemd < 257 and Option B approved: author and review the minimal root launcher; add tests for `/proc` isolation before any host use.
  5. S2: design/review/approve a synthetic-account seeding entry (guarded, TTY-confirmed, operator-only, synthetic markers, no admin bootstrap, no email dependency) — or record that Stage 1 is navigation-only.
  6. Update stale `release-readiness.md` wording about 0039.
- **Validate:** unit tests/lint/type-check pass; `systemd-analyze verify` on rendered units on a workstation with equal-or-newer systemd; secret scan of the diff; owner reviews the diff.
- **Build:** `bun install --frozen-lockfile` (Bun ≥1.4.4) then `bun run build`; assemble the artifact: `.output`, worker/database/scripts import tree, migration SQL/journal, runtime node_modules, licences. Exclude `.git`, `.env*`, captures, test results, keys, backups, storage. Record SHA-256 of the archive and of migration `0039` (`38f19e2f…7819`).
- **Rollback:** revert local uncommitted changes; nothing external touched.

## 5B-2 Authorisation record

- **Prereq:** 5B-1 artifact and diff reviewed.
- **Action:** owner records in writing: host, tier, window, rollback window, names/paths/ports, socket option, isolation option, Nginx/DNS/TLS scope, staging access restriction (IP allowlist and/or basic auth), who may run privileged commands.
- **Stop:** ambiguity about any exact value. **Rollback:** none.

## 5B-3 Baseline snapshot of neighbours (before any change)

- **Action:** capture reference measurements: `MemAvailable`, load, PSI, PostgreSQL connection count, Nginx `nginx -t` result, copy of `/etc/nginx` and `pg_hba.conf` to an owner-controlled backup location, list of running units/ports.
- **Validate:** files readable and stored; neighbours' health checks pass.
- **Rollback:** none; this provides the comparison baseline for every later rollback.

## 5B-4 Runtime and host objects (privileged, minimal)

- **Prereq:** 5B-0…5B-3 complete; slice/units reviewed.
- **Action, in order:**
  1. Install Node 24.12+ (official tarball, verified checksum/signature) to the approved private root-owned path; do not touch `/usr/bin/node` or other apps' runtimes.
  2. Create only the approved system users/groups (`cape-vault-storage`, and `cape-vault-approval`/`-reviewer` if Tier ≥1), no login shell, no home.
  3. Create directories with exact owners/modes: `/srv/cape-vault/releases` (root, 0755), `/etc/cape-vault` and `/etc/cape-vault/secrets/<svc>` (root, 0700/0750 as reviewed, non-symlink), `/var/lib/cape-vault/objects` (storage UID, 0700), `/var/log/cape-vault` (restricted).
  4. Install `cape-vault.slice` and unit files **disabled and stopped**; `systemctl daemon-reload` only after `systemd-analyze verify` passes. Do not install email drop-ins.
- **Validate:** `node -v`; `process.execve` present; `/usr/bin/flock` runs; `ls -ld` of every new path matches the plan; `systemctl list-unit-files | grep cape` shows disabled; neighbours unchanged against 5B-3.
- **Rollback:** `systemctl daemon-reload` after removing only the unit files/slice we added; `userdel`/`groupdel` of our names; remove our empty directories and the private Node directory. Verify against the 5B-3 inventory.

## 5B-5 Dedicated database and roles (DBA, privileged)

- **Prereq:** collision checks repeated immediately before; socket option implemented and tested; backup of `pg_hba.conf` taken.
- **Action:**
  1. Generate four distinct strong passwords privately (never in files in the repo, shell history or process args); store as root-only credential sources under `/etc/cape-vault/secrets/<svc>/` (operator password supplied only for the maintenance session, §5B-7).
  2. Review then apply `ops/postgresql-provision.sql.example` with the real installation UUID, using protected `\password`. Revoke PUBLIC schema `CREATE` in the new DB.
  3. Insert the app-specific `pg_hba` rules before generic ones; `pg_reload_conf()` (reload only; no restart).
  4. Install root-owned `/etc/cape-vault/database-target.json` with the real UUID, exact socket path and no symlinks.
- **Validate:** roles show NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOBYPASSRLS/NOREPLICATION and connection limits; each login connects **only** to `cape_clergy_vault`; each login is **rejected** on every other database and via TCP; no other application's role can connect to the new DB; neighbour applications still connect normally.
- **Rollback:** restore the saved `pg_hba.conf` and reload; `DROP DATABASE cape_clergy_vault` and drop only our four roles (DBA-confirmed, database contains only synthetic/empty data); delete our credential files. Never touch another DB.

## 5B-6 Release delivery and read-only check

- **Prereq:** artifact checksum matches 5B-1; target database empty.
- **Action:** copy the artifact to `/srv/cape-vault/releases/<id>` (root-owned, immutable, no private files); set `current` link; provide a short-lived **operator** credential mount at `/run/credentials/cape-vault-operator.service/database-password` (never visible to services); run `node scripts/service-entry`-independent `scripts/db/production-maintenance.ts check`.
- **Validate:** output reports all 40 migrations pending on the new empty target and refuses to pass the final audit — this is the expected "before" state.
- **Rollback:** remove the operator mount; repoint or remove `current`; delete the release directory.

## 5B-7 Maintenance window: migrate, grants, check

- **Prereq:** explicit maintenance authorisation; TTY session by an authorised operator; all services stopped; backup of the (empty) database dump retained as a baseline.
- **Action:** `production-maintenance.ts migrate` (type the exact confirmation), then `grants`, then `check`.
- **Validate:** full ledger hash match (40 migrations, 0039 hash as recorded), 29 app tables with RLS, role/grant/function/immutable-trigger audits pass; remove the operator mount; confirm no service has inherited it.
- **Stop:** hash mismatch, partial migration, any audit failure.
- **Rollback:** the database is synthetic and disposable at this stage — drop/recreate the empty DB via 5B-5 rollback and re-run. Do not hand-edit the ledger or grants.

## 5B-8 Isolation and credential tests (web only; scanner/mail still stopped)

- **Action:** start `cape-vault-web` only. Execute Phase 5A Appendix B tests: `service-entry` reaches PID 1; `/proc` shows only the service; `/etc/cape-vault/secrets` and sibling credential directories are inaccessible; `process.execve` succeeded; web can write only inside the objects path; an unrelated Linux user cannot read `/var/lib/cape-vault`. If Tier ≥1 and namespace tests for scanner are authorised, briefly start the scanner **without a Bouncer key** and prove web ⇄ scanner `/proc` separation, then stop it.
- **Validate:** every negative test fails with permission/ENOENT; every positive test passes; restart and (separately authorised) reboot preserve results; neighbour baseline unchanged.
- **Stop:** any test cannot be demonstrated; **do not downgrade the sandbox**.
- **Rollback:** `systemctl stop cape-vault-web`.

## 5B-9 Nginx, DNS and TLS (restricted exposure)

- **Prereq:** `nginx -t` clean on current config; `/etc/nginx` backup from 5B-3; DNS name and certificate approved; staging access restriction defined.
- **Action:** add `log_format cape_vault_safe` via an include in `http` context; add the dedicated vhost from `ops/nginx.conf.example` with real names/paths, a restrictive `allow`/`deny` list and/or basic auth; `nginx -t`; reload.
- **Validate:** `nginx -t` passes before reload; other vhosts respond unchanged; HTTPS valid; CSP/nosniff/frame/referrer headers present; cookies `Secure`; access log contains no query strings; non-allowlisted client receives 403.
- **Rollback:** remove our include and vhost, restore saved config, `nginx -t`, reload; verify other vhosts.

## 5B-10 Synthetic walkthrough and observation

- **Action:** with web running and `EMAIL_PROVIDER=disabled`: check `/health/live`, `/health/ready` (`degraded` is expected); navigate public pages; if seeding (S2) was approved, sign in with synthetic accounts only and walk role-gated pages and text-only submissions. Document that verification/reset/notification emails, PDFs and scanning are unavailable.
- **Observe 24–48 h:** web RSS vs `MemoryHigh`, slice memory/CPU, PostgreSQL connections, disk/inodes, journal volume, neighbour latency/errors. Compare to 5B-3.
- **Validate/decide:** within budget → keep Tier 0 and decide separately whether to authorise Tier 1/2; any neighbour regression → stop and roll back.
- **Rollback / teardown (full):** stop and disable our units; remove unit files, slice, Nginx vhost/include (reload), `pg_hba` rules (reload), DB and roles, credential files, users/groups, directories, private Node path; compare to 5B-3 inventory. Retain the operator log.

## Rollback principles

- Roll back in reverse order; each step restores only objects it created.
- Application release rollback is allowed only while the schema contract is compatible; migrations are forward-only and never edited. On the first staging database (synthetic, no real evidence) a full drop/recreate is acceptable; once any non-disposable evidence exists, prefer forward repair.
- Never roll back by changing the migration ledger, loosening RLS/grants, or using owner credentials in a service.
- If a step is interrupted, keep services stopped (maintenance), take stock, and resume only from a verified state.

## Explicitly out of scope until separately authorised

Real Resend delivery and mail loops; Bouncer key and scanner processing of any PDF; any confidential document route; real clergy and real theological resources; production administrator bootstrap; copying development data/secrets; ClamAV; off-host backup of real data; deployment to production; PM2 or container shortcuts; changes to other applications.
