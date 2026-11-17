# Phase 5 deployment preflight — authorization required

Prepared 17 November 2026. This is a reviewable procedure and inactive templates,
not permission to inspect/provision the VPS, deploy, send mail or upload a PDF.
Use synthetic data first. Other hosted applications and their databases remain untouched.

## Entry conditions and stop rules

Obtain explicit infrastructure-owner authorization for the exact host, dedicated
synthetic staging target, ports, identities, database, filesystem paths, resource
budget and rollback window. Obtain independent authorization for any external email
or Bouncer test, including synthetic documents. Real clergy require the separate
[Diocese decisions](diocese-pilot-approval-pack.md). No confidential Bouncer route is
implemented; no environment flag or acknowledgement can enable one.

Stop if names collide, free capacity is insufficient, another app would be changed,
owner credentials would enter a service, isolation cannot be demonstrated, the database
target/marker is wrong, an applied migration hash differs, evidence is missing, or an
object/backup cannot be reconciled. Do not weaken guards or permissions to proceed.

## Host inspection and process boundaries

After authorization, record Ubuntu/kernel, Node 24.12+, Bun 1.4.4+, PostgreSQL/tool
major, systemd, Nginx, socket support, available disk/inodes/RAM, current loads, ports,
existing identities, database roles and backup arrangements. Do not infer free memory
from the host's 4 GB specification. Keep existing apps' service managers unchanged.

Review the inactive units in `ops/systemd/`. They use native services, one web process
and three independently supervised loops, without containers, ClamAV or additional
paid services. `PrivatePIDs=yes` requires systemd 257+ and kernel PID namespaces;
[systemd documents the feature and its limitations](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html).
The launcher additionally refuses to start unless it is unprivileged PID 1.
It uses Node 24's `process.execve` to replace its setup process rather than keep an
extra Node wrapper. The production loop also execs `/usr/bin/flock -F` to retain its lock without an
extra Node parent. Verify this currently experimental Node API and native flock on the approved
build/runtime; there is no spawn fallback. Peak normal Node count is seven: one
web, three loop processes and up to three active batch children (maintenance/build
processes are separate and must not overlap without capacity review). Unsupported
or ignored namespace settings must cause a failed launch, not a quiet downgrade.
Do not upgrade the host's systemd implicitly. If unavailable, review an equivalent
native PID/mount-namespace launcher separately; staging remains blocked meanwhile.

Web and scanner deliberately share only the dedicated storage UID
`cape-vault-storage`, because private directories and objects must keep matching UID,
0700/0600 ownership. Each runs in a separate PID/mount namespace. Web gets the storage
mount read/write; scanner gets it read-only, and its storage adapter independently
rejects save/delete and cannot create directories. Other units' credential mounts and
root-owned source secret directories are hidden. Approval and reviewer mail use
separate Linux identities and have no object mount. No ordinary shared-UID PM2 daemon,
group-readable objects, permission relaxation, Docker socket or shared process dump
is an acceptable substitute. The old PM2 example is historical web-only guidance.

During staging verify, from each sandbox, that `/proc` cannot reveal the other process,
other credential paths and source secrets cannot be opened, scanner writes fail,
object reads pass only for the storage identities, mail cannot read objects, and
unrelated application users cannot read any private data. Verify namespace/mount
behavior after restart and reboot. Neither this test nor these mounts ran locally.

## Database and secrets

Use a dedicated `cape_clergy_vault` database and four project-specific logins. Review
`ops/postgresql-provision.sql.example`; it contains no passwords and must not be run
without checking name ownership/collisions. Existing projects cannot share these roles. Review `ops/pg_hba.conf.example` to
restrict these identities to the dedicated database before generic allow rules;
PUBLIC CONNECT defaults on other databases must not permit cross-application login.
The historical owner role name `cape_clergy_dev` is retained because guarded SQL
operator functions pin it; on this host it is the separately credentialed Cape Vault
migration/operator identity. Never copy the local development password. It has no
superuser/createdb/createrole/bypassrls/replication or memberships, and is absent from
web and worker environments. Service identities own no objects or schemas.

Root installs `/etc/cape-vault/database-target.json` from the template after replacing
the installation UUID. This non-secret file and its ancestors are root-owned and not
group/world-writable; no symlinks. The target pins database, owner, installation marker,
exact host, port and transport. For a local protected Unix socket the exact path is
`/run/cape-vault/postgresql`; its provisioning/permissions must be reviewed against
existing PostgreSQL services. Do not reconfigure a shared socket blindly. Alternatively,
choose an exact approved DNS host with `transport=tls`, root-owned CA file
`/etc/cape-vault/postgresql-ca.pem`, valid hostname/certificate verification and a
confirmed TLS session. There is no arbitrary URL fallback or disabled verification.

Only `CAPE_DATABASE_MODE=production` selects the new factory. Ordinary local mode
retains its exact development host/database/role/marker guards. Production passwords
are read from the exact unit's `LoadCredential` directory, never a browser/environment
URL. The factory rechecks database/owner/marker/session role, unsafe role attributes,
memberships, runtime ownership, TLS where applicable and the security-migration fence.
The read-only operator audit verifies the full ledger, RLS, grants and triggers.

Create root-only secret sources under `/etc/cape-vault/secrets/<service>/`; expose only
per-unit credentials using `LoadCredential`. Templates for non-secret settings are
`ops/{web,scanner,approval,reviewer}.environment.example`. Web and reviewer alone
receive the invitation/auth secret; approval alone needs no invitation key. Scanner
alone receives Bouncer's key. Web and mail need Resend only for separately authorized
sending. Capture files remain sensitive; do not expose a capture viewer remotely.
No operator credential mount is available to a normal service.

Initial synthetic staging templates use `EMAIL_PROVIDER=disabled`, requiring no
Resend key. This mode never sends/captures proof or reports sending success;
verification/reset delivery is unavailable and account verification remains required.
Use only separately authorized pre-seeded synthetic accounts. Keep mail loops stopped.
After provider/domain/test-window approval, add the relevant inactive
`ops/systemd/cape-vault-*.service.d/email.conf.example` credential drop-in and deliberately
change the provider, verified-domain and dynamic sender/enable settings. Remote
capture mode is not enabled as a shortcut.

Pool budget: one shared runtime pool of two connections (auth and health reuse it),
scanner two, each mail process two, operator one temporarily: eight service connections
plus maintenance. A worker needs two because its overlap-prevention advisory lock
reserves one connection while the batch runs. Role connection limits in the template
match this budget. Measure PostgreSQL buffers/connections/work_mem and other apps
before assigning host-wide settings; no global memory tuning is authorized here.

Rotation: stop the affected service and wait for/record leases; rotate only its login
and root credential source through an authorized operator; restart to rebuild pools;
prove both new-login success and old-login failure. Invitation/auth-secret rotation
also requires a separately reviewed session and pending-proof plan: preserve prior
keys in controlled recovery custody or cancel/reissue affected invitations with new
proof. Never silently retry an undecryptable proof or reset provider ambiguity.

## Artifact, maintenance and service sequence

1. Build the reviewed source with locked dependencies using Bun 1.4.4+. The version
   floor matters because scoped overrides use lockfile version 3. Include `.output`,
   the reviewed worker/database/scripts TypeScript import tree, migration SQL/journal,
   required Node dependencies and licenses. Exclude private environments, `.git`,
   captures, test results, keys, backups and storage. Source code and dependencies are
   immutable/root-owned. Building on the VPS is unnecessary resource use.
2. Quiesce mutations and all workers, retain prior release and take a coordinated,
   encrypted database/files backup. Record release identifier and migration hashes.
   Preserve any accepted/ambiguous provider jobs and outstanding leases.
3. Separately provision an ephemeral operator credential mount
   `/run/credentials/cape-vault-operator.service/database-password`. The prepared
   `node scripts/db/production-maintenance.ts check` is read-only. It refuses a
   mismatched applied prefix/newer schema. On a new empty target it reports all
   migrations pending and cannot pass the final audit until migrated/granted.
4. Only after explicit maintenance authorization, use the same guarded entry with
   `migrate`, then `grants`, then `check`. Mutating modes require TTY and exact typed
   confirmation. No migration/grant runs from web or worker startup. Grants render
   the three reviewed local grant sources with only the fixed production database
   name changed; this is exercised against a fresh synthetic production-named DB.
   Remove the operator mount afterward; verify no service inherited it.
5. Reconcile stored bytes/checksums with the database, including quarantine, failed,
   excluded and historical objects. Verify the complete ledger and immutable evidence.
   Missing/orphan/mismatched files block exposure; do not change scan states manually.
6. Review/install the dedicated Nginx vhost, DNS and TLS only within authorized scope.
   The app provides nonce CSP, framing, nosniff, referrer/permissions and protected
   no-store headers. Proxy preserves these, disables buffering/cache and overwrites
   proxy identity headers. HSTS is vhost-only, without includeSubDomains/preload.
7. Start the web and verify `/health/live`, JSON `/health/ready`, actual HTTPS cookies,
   CSP hydration and private page/API errors. Readiness may correctly be degraded
   while scanning is unavailable; an HTTP 200 alone does not establish scanner health.
   An absent security migration blocks DB-backed service startup.
8. Keep scanning and real mail stopped until their separate test window is authorized.
   Initial synthetic staging can use deliberately provisioned synthetic accounts and
   ideas without PDFs with delivery disabled. It cannot claim full PDF/mail acceptance.
   For the approved provider window, use disposable addresses and a blank synthetic
   PDF; validate sender/recipient, quota, hash, exact destination and restart behavior.
   Never use real/confidential data for provider acceptance.
9. Enable one loop for each authorized worker kind. Do not add cron, timers or another
   PM2 schedule. SQL locks, leases, bounded backoff and payload/idempotency snapshots
   remain authoritative. Verify graceful stop, forced restart, stale-lease recovery,
   no duplicate scheduling and no resubmission after uncertain provider acceptance.
10. Complete human accessibility/mobile, backup/restore and operational handover before
    a separate live-pilot decision. Document stop conditions and support contacts.

The proposed slice caps this application group at 1.5 GiB / 130% CPU, with lower soft
budgets and per-service limits. These are initial review values, not measured capacity
claims. Node heap limits leave room for non-heap buffers and loop parents; measure
streaming uploads, provider polling, queue backlog and other apps before acceptance.
Do not install a large resident antivirus daemon on this VPS. Limit disk/inode growth,
restrict logs, and approve retention. The dedicated logrotate template covers Nginx;
review app journal retention without changing global settings affecting other apps.

Monitor queue age, held/ambiguous jobs, quota, disk/inodes, heartbeat failures, DB
availability, required audit failures, certificate expiry and backup verification.
Use existing protected operations reports, with no raw provider payloads, secret links,
query strings, filenames, notes or cookies in logs. Alert recipients and response
ownership must be assigned; no paid monitoring service is assumed.

## Recovery and rollback acceptance

Follow [backup-recovery.md](backup-recovery.md). Back up a quiescent matched database
and all private/quarantined files, release and migration manifest. Encrypt before
leaving the host; keep keys and invitation encryption material under separate controlled
custody, with a tested deputy. Approve destination and retention; never send real data
externally merely to test this procedure. Daily backup, 24h RPO and one-business-day
RTO remain proposals, to be measured and approved.

Restore only into an isolated destination with external delivery blocked. Verify
archive authentication, migration hashes, exact object checksums, immutable history,
roles, proof-key recovery, live access and worker fences before exposure. Existing
Bouncer IDs resume polling only; missing-ID submission markers are ambiguous and
must not be re-uploaded automatically. Provider idempotency retention is finite.
An interrupted deployment stays in maintenance until the backup pair, schema and
objects are reconciled. Roll back the application release only if its schema contract
is compatible. Retain forward migrations; never restore the old schema over new audit
evidence or rewrite history. Otherwise keep maintenance and make a forward repair.

The local disposable drill passes; actual off-host transfer, host reboot, credential
mounts, TLS, namespace isolation, real provider acceptance and measured recovery remain
separate, unexecuted staging gates. Approval records and test evidence must be attached
before changing a CONDITIONAL GO into GO.
