# Coordinated backup and recovery acceptance

No live backup, destructive rotation or existing-database restore is authorized.
The Phase 4 drill uses **two new disposable Unix-socket PostgreSQL clusters** in a
fresh `/tmp/cape-recovery-*` directory, no inherited database URL and no TCP listener.
It verifies each data directory before provisioning synthetic roles. It never restores
over the guarded development database, KBSK, Q-Ahead or any remote database.

## Proposed operational backup

Protect one mutually consistent set: PostgreSQL auth/profiles/capabilities/settings,
submissions/reviews/audits, migration ledger, notification/scan jobs and scan evidence;
all private/quarantined/legacy objects; application release identifier and configuration
schema; ClamAV/worker/supervisor configuration. Provider and Better Auth secrets,
invitation encryption material and backup-decryption keys require a separately
controlled encrypted secret backup. A DB dump alone cannot recover pending invitation
ciphertext. Do not place secrets or captures in ordinary source/database archives.

Proposed dedicated path `/var/backups/cape-vault/`, outside all web/release roots,
0700 directory/0600 material, restricted named backup operator. Verify available disk,
inodes and PostgreSQL tool major versions first. Maintenance disables mutations and
pauses workers, waits for in-flight writes/leases or records their recovery state,
then captures a consistent `pg_dump --format=custom --no-owner --no-acl` and object
snapshot/copy while writers remain stopped. Record release/migration hashes and an
object checksum manifest. Resume only after the pair is complete. An online file copy
and an unrelated-time dump are not a coordinated backup.

Encrypt the archive with authenticated encryption before any off-host transfer.
Select an approved operational tool/key custodian; the drill's Node AES-256-GCM
implementation demonstrates the handling, not a deployed key-management system.
Maintain separate key custody and tested break-glass access. Send encrypted backups
to a dedicated off-host account/path after approval; verify ciphertext transfer and
periodic decryption/restore. Do not reuse other applications' backup stores. Backup
success includes manifest/decrypt verification and a usable recovery key, not just
an exit-zero copy. Never log passwords in connection arguments or archive names.

Proposal for approval: daily coordinated backup, RPO 24 hours and RTO one business
day; consider more frequent backup/PITR after measuring usage and host capacity.
These are **not adopted Diocese requirements**. Retention, off-site location,
frequency, operator/deputy and escalation remain pending in the approval register.
No automated deletion/rotation is included. Legal holds apply to derived copies too.

## Executable local drill

```sh
bun run test:recovery
```

Requires installed supported PostgreSQL binaries and permission to create isolated
local Unix sockets; it installs no package/service. Uses a fresh random owner/runtime/
scanner/notification credential set and disposable example.invalid accounts. Applies
the real migration chain, reviewed grants and RLS, stores two synthetic PDFs, scans
one with explicit TestScanner and leaves one with a durable expired scanner lease.
It creates pending mail with an expired lease and immutable audit evidence.

With no source writers it dumps DB, copies private/quarantined objects, packages the
migration manifest and encrypts an archive with random AES-256-GCM key/nonce and
purpose-bound AAD. Wrong-key and ciphertext-tamper decryption fail. It restores to
the second fresh cluster, reapplies restricted grants, checks identical migration
hashes and audit IDs, rejects audit deletion, verifies exact-hash clean evidence and
author/outsider access, and recovers pending scan/mail work using restricted logins.
Email goes to TestEmailProvider in memory only; there is no Resend request.

Observed final run: **Passed**. Missing object metadata reconciliation fails;
object-without-metadata reconciliation fails; mismatched migration manifest is detected;
wrong invitation encryption key fails. Missing sender credentials fail independently
in `db:test:phase4`. The drill removes only its own disposable tree and stops only its
two new clusters. Safe aggregate evidence is written to ignored
`.local/phase4-recovery-result.json`; no backup, keys or capture is tracked.
An initial drill correctly failed because its pending-mail fixture was absent; that
fixture was added and the complete drill rerun. This was a harness correction, not a
relaxation of recovery checks.

**Limit:** scan verdicts in this drill are synthetic, not real ClamAV evidence.
No host reboot, live off-host transfer, secret-custodian exercise or measured production
RPO/RTO is claimed. Those remain separate gates.

## Restore before service exposure

1. Authorize an isolated destination, release and exact backup pair. Disable external
   email/network delivery. Keep web, scanner and notification loops stopped.
2. Authenticate/decrypt the archive with the separately recovered key; validate manifest,
   release compatibility and every migration hash. Missing key/secret or migration
   mismatch blocks startup; never change the migration ledger to fit a release.
3. Restore database and private/quarantined objects together. Restore reviewed grants,
   filesystem ownership and protected configuration; never restore elevated worker
   credentials or grant missing privileges to work around a restore error.
4. Run full read-only hash inventory before serving any bytes. Missing/unsafe/modified
   objects and unknown/orphan files block exposure until individually reconciled.
   An old `available` flag is insufficient. Preserve scan evidence and compare its exact
   hash; do not fabricate clean results or promote restored legacy/quarantined bytes.
5. Verify immutable audit/review/consent history and live account/assignment gates with
   disposable probes. Revalidate real scanner health/definitions/configuration. Recover
   pending scans through normal lease claims; pending mail remains capture-only until
   explicitly authorized. Unknown provider acceptance needs reconciliation first.
6. Record observed counts, failures, approvals, restoration duration and the final
   reconciliation result. Authorize exposure separately. Preserve backup/incident/hold
   evidence; no destructive cleanup is implied.

The reconciliation barrier is an **operator procedure** exercised by the drill, not an
automatic web-startup lock. Do not start web before it passes. Downloads still require
clean evidence, live RLS and committed authorization/start audits; metadata-only safety
does not replace recovery-time byte reconciliation.
