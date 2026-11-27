# V1 deployment and recovery runbook

**Current host status (26 November 2026):** Phase 5A host acceptance is incomplete and deployment stays blocked; see the [evidence register](phase-5a-evidence-register.md). Historical: revision 3 G1 stopped at offline verification on the noexec `/run` mount (23 November); revision 4 moved three executables to `/opt/cape-probe-exec`. Keep the G0 evidence and peak-capacity requirement. Later probe gates and deployment each require separate approval. [Phase 5A host acceptance](phase-5a-host-acceptance-tests.md)

## Release sequence

1. On a trusted Linux x86-64 builder matching the approved target, select the reviewed source and exact Node 24 patch, check the frozen Bun lockfile, run the local acceptance matrix, then run the commands below. The packager builds the web server, traces worker/operator imports, copies their installed runtime dependencies, migrations, grant scripts and review templates, and tests standalone imports. It writes a private archive, adjacent SHA-256 file and internal file manifest under `.local/releases/`. Record source revision plus any reviewed working-tree diff, build tools and digest in the release record. Promote only the exact reviewed digest. Store the approved archive and provenance separately from the host.

   ```sh
   bun install --frozen-lockfile
   bash scripts/package-v1.sh
   ```

   Package a new immutable archive from the reviewed commit; retain its adjacent SHA-256 and internal manifest. The operator runner in that archive validates all committed ledger hashes, then commits each pending migration and its Drizzle ledger row in one transaction. If it stops after a file commits, keep services stopped, inspect the printed migration tag and SQLSTATE category, rerun `check` to verify the committed prefix, and rerun `migrate` only with the same approved archive and operator authorization. Never insert ledger rows manually. Continue to `grants` and the final `check` only after all 41 migrations are verified.

2. Execute the approved Phase 5A G0 baseline and temporary G1–G3 probes. Verify namespace PID 1 and fresh procfs, dropped capabilities, no-new-privileges, credential and mount negative controls, signal delivery and drain, restart bounds, pids/memory/CPU limits, AppArmor observations and unchanged neighbours. Follow §9 teardown and §10 evidence sign-off. If a control fails, stop at that gate.

3. After separate installation approval, repeat collision checks and provision only the named accounts, paths, private storage and dedicated database in Phase 5B §§3–5. Render the exact approved Node 24 binary path in the launcher, verify its distribution checksum, keep global Node 22, and leave the four units disabled. Use a reviewed isolated socket mount or the supported certificate-verified TLS configuration. Apply database-specific HBA rules and verify negative connections without restarting shared services. Install root-owned releases, launcher, typed target file and four service environments. Verify the release archive digest before extraction and run `sha256sum -c MANIFEST.sha256` inside the new release. Use `install -m 0755` for the launcher. Verify units on systemd 255 before daemon reload. [Phase 5B installation details](phase-5b-staging-execution-plan.md)

4. Set both web limits to 4194304 and the dedicated Nginx vhost to `client_max_body_size 4m`. Install the base slice plus the approved V1 drop-in as `cape-vault.slice.d/v1.conf`. Verify the effective limits with `systemctl cat` and `systemctl show`. The scanner uses Bouncer v1. Install each service's own LoadCredential sources per unit. The scanner alone gets the Bouncer key. Web and reviewer get the auth secret. Only web, approval and reviewer get their own Resend credential mounts when delivery is approved. Initially keep email disabled and the vhost private. No ClamAV daemon is required.

5. Quiesce the four units and obtain a coordinated baseline backup. Check the operator target marker and scoped credential before each DB action. Run the pinned Node binary from the release directory, inside a short-lived `cape-vault-operator.service` with a TTY, `CAPE_DATABASE_MODE=production` and `CAPE_DATABASE_PASSWORD_FILE=/run/credentials/cape-vault-operator.service/database-password`. Load that credential only in the operator unit. The check on an empty or older target prints the pending plan and exits unsuccessfully at the final ledger audit. Only an expected pending plan, on an independently verified target, may proceed to migration. A mismatch, unexpected object or divergent applied hash stops the release.

   ```sh
   "$CAPE_PINNED_NODE" scripts/db/production-maintenance.ts check
   "$CAPE_PINNED_NODE" scripts/db/production-maintenance.ts migrate
   "$CAPE_PINNED_NODE" scripts/db/production-maintenance.ts grants
   "$CAPE_PINNED_NODE" scripts/db/production-maintenance.ts check
   ```

   For a host using the approved Unix socket, the following is the invocation pattern for one command above. Run from the operator terminal, with the path to the checksum-verified Node executable. Repeat with the next authorised action after reviewing the output. The root-owned operator secret source is separate from all four service secret directories.

   ```sh
   systemd-run --unit=cape-vault-operator --collect --wait --pty \
     --property=WorkingDirectory=/srv/cape-vault/current \
     --property=LoadCredential=database-password:/etc/cape-vault/secrets/operator/database-password \
     --property=NoNewPrivileges=yes --property=ProtectSystem=strict \
     --property=ProtectHome=yes --property=PrivateTmp=yes \
     --property=RestrictAddressFamilies=AF_UNIX \
     --setenv=CAPE_DATABASE_MODE=production \
     --setenv=CAPE_DATABASE_PASSWORD_FILE=/run/credentials/cape-vault-operator.service/database-password \
     "$CAPE_PINNED_NODE" scripts/db/production-maintenance.ts check
   ```

   Verify all **41** migration hashes through 0040, RLS on all 30 application tables and the exact role, function and trigger audits. Check the new approval register is empty on first install. For an upgrade, inventory historical confidential and oversized documents, in-flight provider IDs and ambiguous jobs. Preserve all original evidence. Unmount the operator credential before service testing.

6. Apply Phase 5A §10 deferred tests with the rendered units and synthetic identities/objects on the restricted target. Exercise N6/N10, S4–S6, C3–C6, M7–M8, isolation across every actual sibling and restart/reboot in the separately approved scope. Use the real pinned Node, web read/write mount, scanner read-only mount and hidden object tree for mail. Verify the exact drain behavior with a batch running. A live scanner key or Resend send needs its own window. Never start a unit against a restored or accumulated real queue as a test. Complete full-service load acceptance before exposing the service.

7. In an approved **synthetic** provider window, restrict ingress, use only the approved provider account, recipients and synthetic queue, and configure the app's exact origin. Independently verify the domain and sender in Resend. Use the guarded settings operator's `authorize-domain DOMAIN` and confirm the exact sender against the decision. Dynamic DB `transactional_enabled` and `notifications_enabled`, `EMAIL_PROVIDER=resend`, `EMAIL_DOMAIN_VERIFIED=true` and the three mail credential drop-ins must agree. Once the four services are running privately in step 9, complete registration/verification first. Where authorised, use the guarded `scripts/db/administration-operator.ts bootstrap EXACT_ID CAPABILITIES DELEGATIONS` interactively for an independently verified registered identity. Follow the [administration runbook](teft-administration.md) for explicit capability lists, independent reviewer invitation, mailbox proof and coordinator assignment. Use the existing settings manager UI for subsequent sender changes. The initial proposed sender must have its own approval before a verification email is attempted.

8. Only after the actual processing decision and notice for the window are recorded, activate confidential uploads against that decision. Use the exact restricted register ID as the final argument. The register ID is unique. Withdrawal blocks fresh reservations against it. A subsequent decision needs a fresh reference and fresh confidential uploads. Attachments authorised under an earlier decision stay unverified if the earlier reservation never committed. A committed transfer cannot be recalled. If an incident requires an immediate halt, stop the scanner and contain the service as well.

   ```sh
   "$CAPE_PINNED_NODE" scripts/db/production-maintenance.ts approve-confidential REGISTER_ID
   # At withdrawal or end of a time-limited decision
   "$CAPE_PINNED_NODE" scripts/db/production-maintenance.ts withdraw-confidential REGISTER_ID
   ```

9. Start the four units inside the approved restricted window with `systemctl start cape-vault-{web,scanner,approval,reviewer}.service` in Bash. Record startup, worker cycles, queue progress and neighbour baselines. Test proxy/TLS with `nginx -t` before the authorised reload. Run the launch matrix, including both end-to-end providers, backup restoration, alert delivery and accessible/mobile workflows. Close temporary test permissions and reconcile counts and leases. Sign the production approval record separately. Only after that decision, enable the four units for boot and authorise the specific public DNS/vhost change. Verify all four after reboot in a separately approved window.

## Coordinated backup and restoration

The backup operator records the target DB/installation UUID, release and migration digest, designated key custodian, approved destination and hold/retention policy. Reserve space and inodes for staging, the encrypted set and the restore. Pre-provision a private encrypted scratch volume and off-host destination with restricted permissions. Use PG16 client tools with a protected service definition and passfile scoped to the approved DB/transport. Independently verify `current_database()`, `session_user` and `shobj_description(oid,'pg_database')` against the deployment record. Exclude any secret from command arguments and shell tracing.

1. Put ingress into maintenance, stop the four units and confirm inactive cgroups and no remaining writers or maintenance sessions. Wait for drains, record any outstanding leases and accepted provider IDs. Keep this fence in place through both the dump and object snapshot. Do not stop shared PostgreSQL. For first installation, record a verified empty object tree and empty DB.
2. In a fresh operator-only directory on encrypted scratch, with `umask 077`, create the paired set below. Set the service, release directory and approved backup encryption fingerprint from the protected record. Verify the tree contains only expected private directories and regular files, and use the storage inventory to reconcile SHA-256 against DB metadata for objects before sign-off.

   ```sh
   set -euo pipefail
   pg_dump --dbname="service=$CAPE_BACKUP_SERVICE" --format=custom --no-owner --no-acl --file=vault.dump
   pg_restore --list vault.dump > dump-list
   cp -a /var/lib/cape-vault/objects ./objects
   cp "$CAPE_RELEASE_DIR/MANIFEST.sha256" release-manifest
   find objects -type f -print0 | sort -z | xargs -0 -r sha256sum > object-sha256
   sha256sum vault.dump release-manifest object-sha256 > pair-sha256
   tar -cf - vault.dump dump-list objects object-sha256 release-manifest pair-sha256 |
     gpg --batch --recipient "$CAPE_BACKUP_FINGERPRINT" --encrypt --output "$CAPE_NEW_ARCHIVE"
   sha256sum "$CAPE_NEW_ARCHIVE"
   ```

3. Close the paired snapshot and resume writers only under the original approval. Transfer ciphertext to the approved off-host account. Compare its digest there. Back up installation identity, service configuration, Better Auth/invitation secret, provider recovery material and encryption keys under **separate custody**. Keep the plaintext scratch volume restricted until verified and disposed of under the adopted retention/hold policy. Record last successful backup and overdue-backup alerts.
4. Restore to a **new isolated** PG16 instance, database, release and private object root, with outbound providers blocked and all production workers disabled. Use an isolated copy of the marker/role design and verify the target explicitly. Decrypt the authorised archive to fresh encrypted scratch, inspect archive members, extract, then run `sha256sum -c pair-sha256` and the object manifest (empty on an empty installation). Verify the release digest against the separately trusted release. Restore with `pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="service=$CAPE_RESTORE_SERVICE" vault.dump` as the isolated database owner. Restore the objects with their 0700 directory/0600 file ownership and required secrets separately. Apply only reviewed grants and run `production-maintenance.ts check` against this isolated target.
5. Run the guarded `scripts/db/storage-inventory.ts --verify` with the isolated storage UID, read-only object mount and temporary operator credential. Require no unexplained missing/orphan/mismatched objects. Compare counts, audit IDs, migration hashes, exact private clean evidence, policy references and rejection of a historical confidential verdict. Test owner versus unrelated reader, retained invitation decryptability and expired lease recovery with providers blocked/mocked. Reconcile every restored processing decision with the current approval register, including withdrawals since the snapshot. Reconcile accepted/ambiguous scan IDs and email idempotency with the incident lead **before** resuming real delivery from any restored queue. Record recovery time and recoverable point against adopted RTO/RPO. A failed drill stays open.

## Monitoring, containment and rollback

Poll live/ready over the restricted path, parse JSON and alert on essential DB/storage failure. Web has no scanner provider credential. With the V1 units, its scanner probe can report `degraded` even while the scanner is working. Measure actual worker cycles, queue ages and successful scan evidence independently. A web probe alone cannot certify scanning.

Collect `worker.cycle` from each restricted journal and page on three consecutive failed cycles or silence beyond the largest allowed batch plus two cycle intervals. Execute `psql -X -v ON_ERROR_STOP=1 --dbname="service=$CAPE_MONITOR_SERVICE" -f ops/v1-monitor.sql` against the verified target with the protected operator service definition. The queries emit only counts, timestamps and categories. Investigate scan age above 10 minutes on two reports, mail age above 15 minutes, any exhausted/ambiguous job, no eligible intake coordinator or download-audit failure. Alert before the contractual monthly quota and at a block. At low quota retain quarantine and contact the service owner. Check disk and inode thresholds, cgroup events, throttling, neighbour latency, TLS expiry, last successful backup and restore age. Exercise the alert route and record acknowledgement, action and recovery. [Thresholds and response](operations-monitoring.md)

On degraded isolation, disclosure, hash mismatch, failed pre-byte audit or impact on neighbours, stop the affected workflow and restrict ingress. Preserve audit history, queue states, objects, committed provider IDs and the paired backup. Stop only Cape units. Use the Phase 5A probe teardown for temporary probes. Roll back only the dedicated proxy changes after configuration validation. Repoint the release only when its SQL/grant contract is compatible. After real writes, repair forward or restore into isolation and reconcile with the responsible office before cutover. Never reset an ambiguous job, downgrade the ledger, discard real decisions or weaken isolation to resume service.
