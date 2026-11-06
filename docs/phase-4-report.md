# Phase 4 — Controlled pre-production acceptance and release engineering

6 November 2026, Africa/Johannesburg. Branch: `feat/self-hosted-migration`.
Initial working tree: clean. Michael's original attribution, Lovable linkage and
published history were preserved. All changes remain local and uncommitted. The guarded local PostgreSQL cluster was
stopped after final validation, retaining its data and credentials.

## 1. Executive assessment

Implemented a restricted notification-worker database boundary, shared PostgreSQL
abuse limiting with explicit proxy trust, scanner-degraded readiness behavior,
an encrypted coordinated disposable restore drill, browser acceptance extensions
and the requested infrastructure/privacy/operational acceptance packs. This is
local implementation and evidence, not production launch or unrestricted
confidential-use readiness. No existing VPS/application/database was modified.

Staging recommendation: **NO-GO until the identified technical prerequisites are
resolved**. Connection factories deliberately retain local-only guards; production
filesystem/process/secret isolation is a reviewed proposal rather than a provisioned
boundary; supported real ClamAV/FreshClam is unavailable here. Live deliverability,
actual host backup/supervision/monitoring, organizational approvals and human device/
accessibility acceptance remain separate open gates. No simulated result closes them.

## 2. Assessment and implemented boundaries

Reviewed AGENTS.md, README, reports 3A–3F, database/storage/scanning/operations/privacy/
browser/settings/reviewer runbooks; auth/session handlers, RLS/grants/SECURITY DEFINER
functions, outboxes/scanner/storage/audits/health/environment and browser/operator scripts.
Initial risks and their final disposition are in [release readiness](release-readiness.md).
Implemented controls are separated there from local simulations, missing external/host
validation and pending Diocese decisions. Local PostgreSQL was started only through
its guarded marker-aware script; sandbox-local socket restrictions required execution
outside the sandbox. No host package, service, Docker permission or VPS change followed.

Local authorization uses live Better Auth cookies and existing RLS/capability functions.
No browser role grant, implicit admin-as-reviewer, self-assignment/review, direct
submission-status/review-decision write or new private download path was introduced.
Quarantine and legacy clean-evidence gates, author-safe feedback projection, committed
pre-byte audits, append-only history and isolated PWA/offline behavior remain intact.

## 3. Forward database migration

`0032_operational_boundaries.sql`, generated snapshot and additive journal entry:
approval-notification cancellation timestamp; bounded indexed HMAC limiter table with
RLS; narrow notification claim/prepare/check/finish functions and private eligibility
helpers; fixed-policy rate-limit consume function. New functions use fixed pg_catalog
search paths and revoke PUBLIC execution. Migration creates no LOGIN, secrets or real
application capability grants. Chain: **33 entries, 25 application RLS tables**.
Original 0000–0031 SQL/snapshots remain unchanged; matching applied hashes are audited.

Guarded notification provisioning is separate from migration/startup and preserves
existing credentials on repeat. Runtime gets only the limiter function; scanner grants
remain unchanged. See [production roles](production-database-roles.md).

## 4. Notification worker hardening

Both CLI workers use `CAPE_NOTIFICATION_DATABASE_URL`, never the migration owner URL.
The actual notification LOGIN has five EXECUTE grants and no app/auth table CRUD,
DDL/owner memberships, sender changes, decision/role/history mutation or document access.
Reviewer key material stays only in the trusted reviewer delivery process. One tightly
scoped mail identity serves two outboxes; two identities would further isolate domains
at extra operational cost. This trade-off is explicit in the role design.

The shared worker keeps committed five-minute leases, eight attempts, bounded retries,
stable provider keys and first-attempt sender/reply-to/recipient snapshots. SQL rechecks
exact assignment/current revision and live recipient state before provider I/O; expired,
cancelled or stale leases cannot complete. Changed mailbox cancels instead of retargeting.
Provider failures never rewrite business decisions. In-flight provider submission can
still race revocation; links enforce live authorization, and acceptance cannot be recalled.

Actual restricted-role tests cover all requested negative capabilities, concurrent
claims, expired leases, retry exhaustion and stable payload after provider failure.
3E/3F notification suites and browser invitation fixtures now deliver through that same
restricted connection; owner access is limited to explicit disposable fixture preparation.

## 5. Scanning and private storage

Real daemon acceptance is **Blocked**: clamd/FreshClam binaries and default socket are
absent; Docker API access is denied. No installation/escalation to change Docker/system
packages was attempted. Scanner protocol and lifecycle tests use explicit doubles;
the optional installed-daemon test remains skipped. No live malware was downloaded.
The [ClamAV acceptance pack](clamav-operational-acceptance.md) specifies supported
release selection, EICAR, complete 20 MiB input, decompression/stream limits, freshness,
socket cross-UID access, UTC/RAM/reload and recovery evidence required to close the gate.

Only exact-hash clean evidence from a current lease can promote; infected/unknown/
unscanned/legacy/error states remain unavailable. Existing document/download/RLS/audit
regressions cover failure containment. Current 0700 owner-checked storage cannot simply
be shared by different service UIDs; the [architecture](production-architecture.md)
requires reviewed namespace/secret-mount isolation rather than weakened permissions.

## 6. Shared rate limiting and reverse proxy

Replaced custom auth Map and the public-handler memory limiter with one durable SQL
policy system. Login/registration/mail/reset, invitation/admin/test-email, uploads and
repository searches have fixed bounded windows. Client and verified-identity/mailbox
keys are independent where applicable and use HMAC, never plaintext account/IP data.
Concurrent requests and separate Node processes share counters; restart does not reset
limits; expired windows recover. Failures do not fall back to permissive memory limits.
429 responses include bounded Retry-After. Safe denial logs omit credentials/subjects.

Forwarded identity is accepted only from an explicitly configured socket peer and only
as one valid address; missing/invalid chains and missing peer metadata use shared safe
fallbacks. X-Real-IP/Forwarded are ignored. Actual built Node HTTP confirms adapter
metadata and client separation; actual Nginx/TLS/firewall/load behavior remains untested.
See [shared limiter](shared-rate-limiting.md) and inactive Nginx template.

## 7. Monitoring, scheduling and health

Proposed [supervision](worker-supervision.md) defines one bounded loop per worker,
60–65 second post-batch wait, batch 20, signal/drain deadlines, leases, backlog and
exhaustion handling. Worker cycle logs have correlation IDs and failure counts.
No duplicate cron/systemd/PM2 schedule or service was activated. Dependency services
remain separately supervised; host reboot/fault/alert delivery needs staging evidence.

`/health/live` stays dependency-free. `/health/ready` returns ready/200, scanner-only
degraded/200 or essential dependency/capacity unavailable/503, with generic no-store
responses. Monitors must inspect JSON for degradation; a scanner outage must not
restart healthy web. Promotion remains independently fail-closed. Protected reports
retain aggregate backlog/inventory/capacity diagnostics and now exclude cancelled
approval messages from outstanding counts. Alert thresholds/owners are proposals.

## 8. Backup/restore results

**Passed locally:** `test:recovery` creates two new private Unix-socket PostgreSQL
clusters under fresh /tmp paths, uses no existing database URL and removes only its
disposable data. A quiescent synthetic source includes auth/roles/audits, one clean
TestScanner PDF, one pending expired scan lease and an expired pending mail lease.
It coordinates DB/object backup, encrypts with authenticated AES-256-GCM, rejects wrong
keys/tampering, restores independently, verifies matching ledger/audit IDs and immutable
triggers, confirms author/outsider RLS and exact-hash evidence, detects missing/orphan
objects and migration manifest mismatch, and recovers queues with restricted workers.
Wrong invitation key and missing sender credentials fail closed. Email is memory-only.

Initial drill failed because no pending-mail fixture existed; the fixture was added and
the complete drill passed. No assertion was relaxed. Synthetic scans do not establish
real antivirus or production recovery performance. No off-host transfer/key-custodian
exercise or approved RPO/RTO is claimed. See [recovery procedure](backup-recovery.md).
Pre-exposure reconciliation is an explicit operator barrier, not an automatic startup lock.

## 9. Email acceptance

Captured/synthetic verification/reset, approval, invitation, assignment and review-result
regressions run without Resend. Sender settings remain dynamic in PostgreSQL; credentials
remain protected environment configuration. No real sending flag was enabled, no DNS
changed and no actual invalid-key/provider acceptance/delivery was tested. Reported
sending-domain verification remains owner-reported evidence.

[Deliverability acceptance](email-deliverability-acceptance.md) requires exact recipient/
operation authorization, separates queued/provider-accepted/rejected/confirmed/cancelled/
ambiguous/exhausted states and defines recovery. Legacy delivered_at means provider
acceptance, not proven inbox receipt. No durable provider receipt/webhook model is added.

## 10. Privacy, human accessibility and mobile

[Approval register](privacy-approval-register.md) contains only pending decisions,
proposed responsible offices/options/risks, no invented people/dates/evidence.
Privacy wording, processing basis, consent, retention/holds, subject rights, incidents,
operator responsibility, backups and RPO/RTO require actual Diocese approval.
Retention preview stays read-only; no data disposal or backup rotation is enabled.
Technical safeguards do not establish POPIA compliance.

[Manual acceptance](manual-accessibility-acceptance.md) covers keyboard/focus/dialogs,
screen-reader status/errors, uploads/review, 200%/400% reflow, reduced motion/forced
colors, mobile assistive technology and touch. All human observations remain Pending.
Chromium/axe/viewports are automated evidence only; no physical Android/iPhone,
Safari/WebKit/Firefox or human WCAG acceptance is claimed.

## 11. Exact validation results

Exploratory runs exposed test assumptions rather than accepted results: restarting
an auth service no longer clears durable limits; independent high-volume upload/
invitation scenarios needed isolation of their own fixture windows; structured denial
logs required a distinct child-process result record; and the browser expiry fixture
needed UTC conversion for Better Auth's timestamp-without-time-zone column. Those
assertions were retained and rerun. An HTTP Headers object also normalizes optional
outer whitespace, so the proxy unit test now checks invalid addresses/chains rather
than expecting preserved transport whitespace. No failed exploratory run is counted
as acceptance. Final command results are below. An additional broad all-documents
Prettier check flagged pre-existing formatting in phase-2a-report.md and
phase-2b-report.md; those historical reports remain unchanged. The requested focused
format check covers Phase 4's changed/new supported files only.

| Command                                                  | Final result                                                                              | Failed | Skipped                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ | ------------------------ |
| `bun run typecheck`                                      | passed                                                                                    | 0      | 0                        |
| `bun run test`                                           | 43 tests / 11 files passed                                                                | 0      | 0                        |
| `bun run db:test:unit`                                   | 3 passed                                                                                  | 0      | 0                        |
| `bun run db:test`                                        | 3 passed                                                                                  | 0      | 0                        |
| `bun run db:test:auth`                                   | 10 passed                                                                                 | 0      | 0                        |
| `bun run db:test:phase3a`                                | 12 passed                                                                                 | 0      | 0                        |
| `bun run db:test:phase3b`                                | 17 passed                                                                                 | 0      | 0                        |
| `bun run db:test:phase3c`                                | 18 passed                                                                                 | 0      | 0                        |
| `bun run db:test:phase3d`                                | 10 passed                                                                                 | 0      | 0                        |
| `bun run db:test:phase3e:boundary`                       | 5 passed                                                                                  | 0      | 0                        |
| `bun run db:test:phase3e`                                | 22 passed                                                                                 | 0      | 0                        |
| `bun run db:test:phase3f`                                | 18 passed                                                                                 | 0      | 0                        |
| `bun run db:test:phase3f:notifications`                  | 10 passed                                                                                 | 0      | 0                        |
| `bun run db:test:phase4`                                 | 17 passed                                                                                 | 0      | 0                        |
| `bun run test:recovery`                                  | isolated encrypted two-cluster restore passed; synthetic scan, memory-only email          | 0      | 0                        |
| `bun run test:scanner`                                   | 14 passed                                                                                 | 0      | 1 real-clamd integration |
| `bun run db:check`                                       | passed                                                                                    | 0      | 0                        |
| `bun run build`                                          | Node/client build and generateSW passed                                                   | 0      | 0                        |
| `bun run db:smoke:phase3a`                               | built Node HTTP scenario PASS                                                             | 0      | 0                        |
| `bun run db:smoke:phase3b`                               | built Node HTTP scenario PASS                                                             | 0      | 0                        |
| `bun run db:smoke:phase3c`                               | 11 passed                                                                                 | 0      | 0                        |
| `bun run db:smoke:phase3d`                               | built Node HTTP scenario PASS                                                             | 0      | 0                        |
| `bun run db:smoke:phase3e`                               | 22 passed                                                                                 | 0      | 0                        |
| `bun run db:smoke:phase4`                                | built Node HTTP scenario PASS                                                             | 0      | 0                        |
| `bun run test:browser`                                   | 16 passed; Playwright 3.0m; command 197s; 4 Chromium viewports + axe                      | 0      | 0                        |
| `bun run db:audit:phase3e`                               | 33 matching hashes, 25 RLS tables, restricted grants, 53 credential-free public artifacts | 0      | 0                        |
| `bun run db:audit:phase3f`                               | 33 matching hashes, 25 RLS tables, restricted grants, 53 credential-free public artifacts | 0      | 0                        |
| `bun run test:browser --grep "shared mail limits"`       | 4 new cases passed across all viewports (20.8s)                                           | 0      | 0                        |
| `bun run db:migrate`                                     | passed twice; ignored credential files unchanged                                          | 0      | 0                        |
| `bun run db:runtime:setup`                               | passed twice; ignored credential files unchanged                                          | 0      | 0                        |
| `bun run db:scanner:setup`                               | passed twice; ignored credential files unchanged                                          | 0      | 0                        |
| `bun run db:notifications:setup`                         | passed twice; ignored credential files unchanged                                          | 0      | 0                        |
| `bun run storage:inventory -- --verify`                  | 0 documents, findings, unknown or temporary objects; full hash verification               | 0      | 0                        |
| `bun run operations:report`                              | 0 pending/stale/exhausted queues; scanner unavailable explicitly reported                 | 0      | 0                        |
| `bun run retention:preview`                              | read-only; all default policies pending; no disposal authorized                           | 0      | 0                        |
| `bun run db:generate -- --name=phase4_final_drift_check` | no schema changes; no migration emitted                                                   | 0      | 0                        |
| Focused ESLint                                           | 38 changed/new code files passed                                                          | 0      | 0                        |
| Focused Prettier                                         | 59 changed/new supported files passed                                                     | 0      | 0                        |
| Historical migration/snapshot diff                       | original 0000–0031 unchanged                                                              | 0      | 0                        |
| `git diff --check`                                       | passed                                                                                    | 0      | 0                        |
| Environment/artifact boundary                            | only .env.example tracked; new worker env 0600/ignored; private evidence/storage ignored  | 0      | 0                        |

Node summaries include parent tests, following each runner. No unresolved automated
failures remain. Real ClamAV is the single explicit automated skip; real host/provider
and human checks are separately Blocked/Not tested/Pending in the readiness matrix.
Private logs/results remain ignored under `.local/phase4-validation/`. No private
capture/storage artifact is staged or tracked.

## 12. Failure and recovery evidence

| Fault                            | Expected behavior                                              | Observed scope                                                                             |
| -------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Application restart              | shared limit survives; sessions revalidated                    | 3A service recreation and independent built process starts; host restart Not tested        |
| DB unavailable                   | health unavailable, no unauthorized bytes or phantom decisions | dependency/audit fault injection; actual running-DB outage Not tested                      |
| Scanner daemon unavailable/stale | quarantine preserved; web degraded, promotions blocked         | protocol/lifecycle doubles + actual missing-socket readiness; real daemon recovery Blocked |
| Scanner worker crash             | unfinished lease recoverable; stale completion denied          | restricted DB/restore expired-lease fixtures; actual SIGKILL during daemon I/O Not tested  |
| Notification worker crash        | stable payload/lease recovery; reconcile ambiguity             | restricted worker and restored expired leases; actual supervised process crash Not tested  |
| Provider outage                  | bounded retry; business decision unchanged                     | synthetic rejecting provider/captured evidence; real Resend outage Not tested              |
| Storage missing/unavailable      | bytes unavailable; reconciliation blocks exposure              | real disposable missing objects/write failures + readiness dependency tests                |
| Disk/inode warning               | alert operator, critical floor unavailable                     | dependency-value boundary tests; no host disk filled; actual alert Not tested              |
| Restored pending queues          | preserve scan/mail intents and evidence                        | two-cluster encrypted restore; restricted workers recovered pending jobs                   |
| Expired/stale leases             | only current unexpired claimant completes                      | actual restricted DB tests and restore                                                     |
| Invalid environment/key          | configuration/secret failure, no delivery/promotion bypass     | invalid target/proxy/provider/key tests; no host environment modified                      |

## 13. Files created/modified

| File                                                                                                          | Change   |
| ------------------------------------------------------------------------------------------------------------- | -------- |
| [.env.example](../.env.example)                                                                               | Modified |
| [README.md](../README.md)                                                                                     | Modified |
| [browser/acceptance.spec.ts](../browser/acceptance.spec.ts)                                                   | Modified |
| [browser/fixtures.ts](../browser/fixtures.ts)                                                                 | Modified |
| [database/auth/config.server.ts](../database/auth/config.server.ts)                                           | Modified |
| [database/integration.test.ts](../database/integration.test.ts)                                               | Modified |
| [database/migrations/0032_operational_boundaries.sql](../database/migrations/0032_operational_boundaries.sql) | Created  |
| [database/migrations/meta/0032_snapshot.json](../database/migrations/meta/0032_snapshot.json)                 | Created  |
| [database/migrations/meta/_journal.json](../database/migrations/meta/_journal.json)                           | Modified |
| [database/notifications-grants.sql](../database/notifications-grants.sql)                                     | Created  |
| [database/notifications.server.ts](../database/notifications.server.ts)                                       | Created  |
| [database/phase3a.test.ts](../database/phase3a.test.ts)                                                       | Modified |
| [database/phase3c.test.ts](../database/phase3c.test.ts)                                                       | Modified |
| [database/phase3e.test.ts](../database/phase3e.test.ts)                                                       | Modified |
| [database/phase3f-notifications.test.ts](../database/phase3f-notifications.test.ts)                           | Modified |
| [database/phase4.test.ts](../database/phase4.test.ts)                                                         | Created  |
| [database/runtime-grants.sql](../database/runtime-grants.sql)                                                 | Modified |
| [database/safety.ts](../database/safety.ts)                                                                   | Modified |
| [database/schema/approval.ts](../database/schema/approval.ts)                                                 | Modified |
| [database/schema/index.ts](../database/schema/index.ts)                                                       | Modified |
| [database/schema/rate-limits.ts](../database/schema/rate-limits.ts)                                           | Created  |
| [database/test-rate-limits.ts](../database/test-rate-limits.ts)                                               | Created  |
| [docs/application-settings.md](application-settings.md)                                                       | Modified |
| [docs/backup-recovery.md](backup-recovery.md)                                                                 | Created  |
| [docs/browser-acceptance.md](browser-acceptance.md)                                                           | Modified |
| [docs/clamav-operational-acceptance.md](clamav-operational-acceptance.md)                                     | Created  |
| [docs/database.md](database.md)                                                                               | Modified |
| [docs/document-scanning.md](document-scanning.md)                                                             | Modified |
| [docs/email-deliverability-acceptance.md](email-deliverability-acceptance.md)                                 | Created  |
| [docs/manual-accessibility-acceptance.md](manual-accessibility-acceptance.md)                                 | Created  |
| [docs/operations-monitoring.md](operations-monitoring.md)                                                     | Modified |
| [docs/phase-4-report.md](phase-4-report.md)                                                                   | Created  |
| [docs/privacy-approval-register.md](privacy-approval-register.md)                                             | Created  |
| [docs/privacy-retention-readiness.md](privacy-retention-readiness.md)                                         | Modified |
| [docs/production-architecture.md](production-architecture.md)                                                 | Created  |
| [docs/production-database-roles.md](production-database-roles.md)                                             | Created  |
| [docs/release-readiness.md](release-readiness.md)                                                             | Created  |
| [docs/reviewer-operations.md](reviewer-operations.md)                                                         | Modified |
| [docs/shared-rate-limiting.md](shared-rate-limiting.md)                                                       | Created  |
| [docs/storage.md](storage.md)                                                                                 | Modified |
| [docs/worker-supervision.md](worker-supervision.md)                                                           | Created  |
| [ops/ecosystem.config.cjs](../ops/ecosystem.config.cjs)                                                       | Created  |
| [ops/nginx.conf.example](../ops/nginx.conf.example)                                                           | Created  |
| [package.json](../package.json)                                                                               | Modified |
| [scripts/db/approval-notifications.ts](../scripts/db/approval-notifications.ts)                               | Modified |
| [scripts/db/notification-setup.ts](../scripts/db/notification-setup.ts)                                       | Created  |
| [scripts/db/operations-report.ts](../scripts/db/operations-report.ts)                                         | Modified |
| [scripts/db/phase3e-audit.ts](../scripts/db/phase3e-audit.ts)                                                 | Modified |
| [scripts/db/phase3f-audit.ts](../scripts/db/phase3f-audit.ts)                                                 | Modified |
| [scripts/db/phase4-http.ts](../scripts/db/phase4-http.ts)                                                     | Created  |
| [scripts/db/recovery-drill.ts](../scripts/db/recovery-drill.ts)                                               | Created  |
| [scripts/db/reviewer-notifications.ts](../scripts/db/reviewer-notifications.ts)                               | Modified |
| [scripts/worker-loop.mjs](../scripts/worker-loop.mjs)                                                         | Created  |
| [src/lib/approvals/notifications.server.ts](../src/lib/approvals/notifications.server.ts)                     | Modified |
| [src/lib/approvals/service.server.ts](../src/lib/approvals/service.server.ts)                                 | Modified |
| [src/lib/auth/service.server.ts](../src/lib/auth/service.server.ts)                                           | Modified |
| [src/lib/documents/service.server.ts](../src/lib/documents/service.server.ts)                                 | Modified |
| [src/lib/notifications/worker.server.ts](../src/lib/notifications/worker.server.ts)                           | Created  |
| [src/lib/operations/health.server.ts](../src/lib/operations/health.server.ts)                                 | Modified |
| [src/lib/operations/health.test.ts](../src/lib/operations/health.test.ts)                                     | Modified |
| [src/lib/reviews/notifications.server.ts](../src/lib/reviews/notifications.server.ts)                         | Modified |
| [src/lib/reviews/service.server.ts](../src/lib/reviews/service.server.ts)                                     | Modified |
| [src/lib/security/rate-limit.server.ts](../src/lib/security/rate-limit.server.ts)                             | Created  |
| [src/lib/security/rate-limit.test.ts](../src/lib/security/rate-limit.test.ts)                                 | Created  |
| [src/lib/settings/service.server.ts](../src/lib/settings/service.server.ts)                                   | Modified |
| [src/lib/submissions/service.server.ts](../src/lib/submissions/service.server.ts)                             | Modified |

New documents/templates are review artifacts; no infrastructure configuration was activated.

## 14. Remaining blockers and exact next steps

1. Review this local diff and evidence. No commit/push/merge is authorized.
2. Review target-specific database/ownership/TLS guards and operator provisioning before
   any nonlocal connection; do not remove the existing local guards to make deployment work.
   Also review an isolated capture-only staging mail mode: current production capture
   override intentionally permits only localhost, so remote testing needs an approved
   safe transport boundary or explicitly authorized real mail configuration.
3. Resolve namespace/filesystem/secret isolation with the actual infrastructure owner;
   current provider ownership checks prohibit ordinary cross-UID root sharing. Approve
   dedicated users/paths/ports/capacity without affecting KBSK/Q-Ahead.
4. Separately authorize an isolated ClamAV installation and run the full real-daemon pack.
   Keep confidential upload acceptance blocked until complete-input/limit/freshness/access
   tests pass; no fabricated clean evidence or weaker thresholds.
5. Designate operational owners/on-call/deputies; approve backup/key/off-host/RPO/RTO and
   privacy/retention/holds/subject-request/incident policies. Complete human acceptance.
6. After technical review, request separate exact staging provisioning authorization.
   Provision no existing VPS change implicitly. Exercise host restart, DB/scanner/socket/
   updater/worker/provider/storage faults, realistic load, capacity alerts and off-host
   restore in isolation with capture-only/disposable data.
7. Obtain separate exact live-mail recipient/type/count/time-window authorization and
   execute provider/domain/deliverability acceptance. No DNS/provider configuration
   change is implied. Reconcile ambiguous/exhausted intents before any manual recovery.
8. Reassess every open matrix row with objective evidence before requesting production
   launch authorization. Do not begin a later phase, chat/OAuth migration or disposal.

## 15. Recommendation

**NO-GO for staging until identified technical blockers are resolved**
