# Phase 3F implementation report

Implemented locally on 5 November 2026, Africa/Johannesburg, on
`feat/self-hosted-migration`, starting with a clean working tree. Michael's original
concept/development attribution and Lovable history notice are preserved. No commit,
push, merge, history rewrite, deployment, VPS/DNS/provider reconfiguration, real
privileged account or real recipient email delivery was performed.

## 1. Result and acceptance boundary

Phase 3F implements exact-assignment notification checks, durable private PDF
quarantine, a restricted scan worker and ClamAV Unix-stream adapter, fail-closed
SQL authorization, operational health/reports, typed pending retention previews,
and real Chromium/axe acceptance infrastructure. This is pre-launch implementation,
not unrestricted confidential-use or production-release approval.

A real clamd daemon/signature installation is absent locally: the real-scanner
integration test is explicitly skipped. Socket protocol tests use an isolated fake
daemon, and lifecycle/browser fixtures explicitly inject TestScanner against actual
disposable stored PDF bytes. Neither is represented as production malware scanning.
Missing/stale/unusable scanners never promote new files. Organizational privacy,
retention/hold, investigation and disposal approvals remain outstanding.

## 2. Review and scope

Reviewed AGENTS.md, prior 3C/3D/3E reports, storage/reviewer/settings/submission/database
runbooks, storage upload/finalize/download/audit code, assignment/outbox workers,
auth/session boundaries, current RLS/functions/grants, test infrastructure, ignore
rules and isolated PWA/offline rules before implementation. Verified branch and clean
working tree. The existing marked project PostgreSQL cluster was stopped initially;
only that guarded cluster was started for tests. It was stopped again after final
validation, retaining data and credentials. Existing private environments and
historical migrations were preserved. No unrelated database was accessed.

Checkpoint A was implemented and validated first (seven restricted-role regression
tests) before scanning work. Its final expanded suite adds provider/revocation race
cases. No known authorization regression was carried into subsequent checkpoints.

The StorageProvider and original private filesystem implementation are unchanged.
Read-only inventory logic was extracted into a reusable operator diagnostic helper
so the command and aggregate report share reconciliation semantics. The guarded DB
URL/identity validator was extended only for the exact separately marked scanner role.
Auth, PWA, offline chat/outbox and Supabase legacy integrations were not rewritten.

## 3. Forward migrations and privilege review

| Migration                                  | Purpose                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `0026_assignment_notification_consistency` | exact assignment/recipient/submission/revision eligibility, transactional cancellation and immutable cancellation audit         |
| `0027_document_quarantine`                 | scan jobs/events, scan-state/check constraints and indexes, RLS tables                                                          |
| `0028_scan_authorization`                  | legacy demotion with evidence, quarantine intent, restricted claim/finalize, clean download RLS/audit, explicit legacy queueing |
| `0029_scan_submission_gate`                | version-checked submit wrapper requires clean included attachments; internal predecessor is not runtime-executable              |
| `0030_scan_global_concurrency`             | global two-live-lease cap across worker processes; internal claim function is not worker-executable                             |
| `0031_infected_scan_evidence`              | verified infection evidence survives exclusion/ineligibility during scanner I/O                                                 |

Six generated snapshots and journal entries accompany these additive migrations.
The final chain has 32 migration hashes, 24 RLS application tables and four auth tables.
No previously applied SQL/snapshot is edited. SQL functions use fixed `pg_catalog`
search paths and schema-qualified references; PUBLIC execution is revoked. Reviewed
runtime grants exclude scan evidence/jobs and every scanner mutation. The scanner
login has only claim/finalize EXECUTE, no direct table reads/writes, owner membership,
owned schemas/relations, elevated flags or database CREATE/TEMP. Function authorization
checks actual `session_user`; forged actor settings cannot become scanner authority.

Immutable scan events join existing append-only audit/consent/approval/review/event
histories. Repeated guarded migration and runtime/scanner setup preserve credentials.
No real reviewer/admin/approver grant runs in migration or startup. All operator test
fixtures are explicit disposable identities, not email-matched privileged accounts.

## 4. Notification consistency

One joined assignment must match notification assignment ID, recipient, submission,
active state and exact current revision. Live verified/approved/consented clergy and
reviewer grants remain required through `app.can_review_submission`; actionable new
assignment mail is limited to submitted/under-review resources. Revocation and revision/
status supersession cancel pending notices atomically, with ID-only cancellation audit.
A newer assignment cannot validate an old event, including preserved pre-fix events.

The worker rechecks the committed lease/eligibility immediately before provider I/O.
Regression tests cover revocation during preparation and after provider submission.
Revocation after the final committed check can race provider submission/completion;
there is no atomic database/provider transaction. Submitted mail may be impossible
to recall; cancelled intent evidence and live
link authorization remain. A retry whose captured actionable recipient no longer matches the live verified
mailbox is cancelled without retargeting its stable payload. Stable keys/payloads, leases, bounded retries, common dynamic
PostgreSQL sender settings and review-decision independence are preserved.

## 5. Scanner/quarantine and recovery

See [document scanning](document-scanning.md) for complete state/verdict semantics,
trust boundaries, freshness, exact-byte hashing and recovery. Upload validation now
commits quarantine plus durable work, never immediate availability. Existing available
objects become legacy-unscanned with audit, never invented clean evidence. A guarded
exact-ID confirmation may queue legacy reconciliation, without promotion.

Only current unexpired restricted-worker leases can record clean results and promote.
Job hashes must match document metadata and the exact streamed stored bytes. A second
read/hash verifies current key identity before promotion. Missing/modified bytes,
unknown/incomplete/error replies and size-limit failures remain unavailable. Parent
exclusion and live author eligibility are rechecked after I/O; an infection verdict
is preserved even if eligibility changes. Immutable events capture attempts/outcomes.

The Unix adapter refuses public/symlink sockets, uses bounded INSTREAM chunks, validates
complete replies and engine/database build information, checks definitions before/after
scanning, and bounds connections/exchanges/total scan time. Age defaults to 48 hours,
configurable 1–72 with an independent 72-hour SQL ceiling. Health requires a responding
daemon, engine/support, fresh signatures and successful harmless complete PDF probe.
An early clamd size-limit error is retained even if writes disconnect concurrently.

Claims commit before I/O. SKIP LOCKED/random tokens/five-minute leases, global two-lease
cap, five attempts, backoff, stale-result rejection, retry exhaustion and explicit error
states make interruption recoverable without duplicate promotion. Lost DB commits are
not treated as success. No file is copied into an unrestricted scanner/quarantine viewer,
emailed as an attachment or destroyed by a malware/retention cleanup task.

## 6. Operations and privacy

`/health/live` is dependency-free. `/health/ready` returns only ready/degraded/unavailable,
with no-store; DB/storage failure or critical capacity is unavailable, scanner failure
is degraded. Probes coalesce for 15 seconds. Protected CLI reports supply aggregate
queue ages/counts/exhaustion, safe scanner categories, inventory inconsistencies and
capacity. There is no public diagnostics endpoint. Worker commands/scheduling, bounded
claims, restart recovery and proposed alert thresholds are in
[operations monitoring](operations-monitoring.md).

Approval/reviewer workers still use existing guarded owner tooling locally. Production
must provision separately reviewed restricted email-worker functions/logins and host
supervision; the new scanner role does not silently make those workers production-ready.
No paid monitoring platform, daemon or production schedule was installed.

[Privacy/retention readiness](privacy-retention-readiness.md) inventories authentication,
profiles, approvals, reviewer evidence, submissions, PDFs, audits, notifications, captures,
logs and backups. All default retention decisions have no duration, pending approval
and unresolved legal holds. Read-only previews support validated hypothetical policy
files but force immutable categories to remain immutable, flag record-specific hold
review and never authorize disposal. No actual data deletion workflow or legal wording/
period is invented. Subject rights, backup-derived copies and legal decisions remain
explicit organizational work.

## 7. Browser and accessibility

[Browser acceptance](browser-acceptance.md) documents actual DOM/user journeys and
manual gaps. Chromium was installed through the normal supported Playwright setup.
The isolated built server uses only runtime credentials, private temporary storage,
captured mail and a non-loopback fetch guard. Tests use disposable accounts and PDFs,
exact trusted local fixture operations and genuine verification/invitation delivery.

Axe uses WCAG 2/2.1 A/AA tags without blanket contrast suppressions. Checks include
stable authentication/account/error/status, approvals/dialogs, settings, draft/quarantine,
reviewer invitation/workspace/details, long feedback, repository and unavailable states.
Dialog Tab focus and root overflow are checked. The 320-pixel settings email-test button
was fixed to wrap. Measurements wait for fonts/finite animations. Login pacing preserves
real rate limits; live role-switch sessions stay in memory, without persistent auth files.

Exploratory runs exposed harness URL/label/transient-status matchers, premature completion
waits, per-IP login limits and transient animation measurements; those were corrected.
Some exploratory runs were interrupted to apply fixes. Their failures were not reported
as successful acceptance. No trace/video/screenshot or auth-state artifact is committed.
Physical devices, WebKit/Firefox, manual assistive technology, zoom/forced colors and a
complete human keyboard review remain launch requirements.

## 8. Final validation evidence

Final command results are recorded below after the last validation run. Node test counts
include named parent tests, following each runner's own summary; standalone smoke scripts
report a scenario PASS rather than a Node assertion count.

| Command                                                                     | Final result                                                                                                                                           | Failed | Skipped                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------- |
| `bun run typecheck`                                                         | pass                                                                                                                                                   | 0      | 0                            |
| `bun run test`                                                              | 40 tests / 10 files passed                                                                                                                             | 0      | 0                            |
| `bun run db:test:unit`                                                      | 3 passed                                                                                                                                               | 0      | 0                            |
| `bun run db:test`                                                           | 3 passed                                                                                                                                               | 0      | 0                            |
| `bun run db:test:auth`                                                      | 10 passed                                                                                                                                              | 0      | 0                            |
| `bun run db:test:phase3a`                                                   | 12 passed                                                                                                                                              | 0      | 0                            |
| `bun run db:test:phase3b`                                                   | 17 passed                                                                                                                                              | 0      | 0                            |
| `bun run db:test:phase3c`                                                   | 18 passed                                                                                                                                              | 0      | 0                            |
| `bun run db:test:phase3d`                                                   | 10 passed                                                                                                                                              | 0      | 0                            |
| `bun run db:test:phase3e:boundary`                                          | 5 passed                                                                                                                                               | 0      | 0                            |
| `bun run db:test:phase3e`                                                   | 22 passed                                                                                                                                              | 0      | 0                            |
| `bun run db:test:phase3f`                                                   | 18 passed                                                                                                                                              | 0      | 0                            |
| `bun run db:test:phase3f:notifications`                                     | 10 passed                                                                                                                                              | 0      | 0                            |
| `bun run test:scanner`                                                      | 14 passed                                                                                                                                              | 0      | **1 real-clamd integration** |
| `bun run db:smoke:phase3a`                                                  | standalone built-HTTP scenario PASS                                                                                                                    | 0      | 0                            |
| `bun run db:smoke:phase3b`                                                  | standalone built-HTTP scenario PASS                                                                                                                    | 0      | 0                            |
| `bun run db:smoke:phase3c`                                                  | 11 built-HTTP tests passed                                                                                                                             | 0      | 0                            |
| `bun run db:smoke:phase3d`                                                  | standalone built-HTTP scenario PASS                                                                                                                    | 0      | 0                            |
| `bun run db:smoke:phase3e`                                                  | 22 built-HTTP tests passed                                                                                                                             | 0      | 0                            |
| `bun run test:browser`                                                      | **12 passed**, four Chromium viewports, axe/focus/overflow checks; 429.98 seconds; no flaky cases                                                      | 0      | 0                            |
| `bun run build`                                                             | Node/client build and generateSW pass                                                                                                                  | 0      | 0                            |
| `bun run db:migrate`, `db:runtime:setup`, `db:scanner:setup`                | each repeated successfully after final migration                                                                                                       | 0      | 0                            |
| `bun run db:check` and no-op `db:generate --name=phase3f_final_drift_check` | pass; no schema changes/migration emitted                                                                                                              | 0      | 0                            |
| `bun run db:audit:phase3e`, `db:audit:phase3f`                              | pass: 32 hashes, 24 RLS tables, restricted grants/search paths, enabled immutable triggers, 53 public artifacts without configured private credentials | 0      | 0                            |
| `bun run storage:inventory -- --verify`                                     | 0 documents/findings/temporary/unknown objects                                                                                                         | 0      | 0                            |
| `bun run operations:report`                                                 | 0 pending/stale/exhausted queues or inventory inconsistencies; scanner explicitly unavailable                                                          | 0      | 0                            |
| `bun run retention:preview`                                                 | no eligible disposal; all default policies pending; external log/backup inventory uncounted                                                            | 0      | 0                            |
| Focused ESLint / Prettier                                                   | all changed TypeScript and handwritten supported files pass; generated Drizzle JSON retains generator formatting                                       | 0      | 0                            |
| `git diff --check` and environment/artifact ignore checks                   | pass; only root `.env.example` tracked; private/test artifacts ignored                                                                                 | 0      | 0                            |

The one scanner skip is exactly: no installed local clamd Unix socket, and no
production service installation is authorized in this phase. Supported Chromium
installation succeeded; browser execution is **not** skipped. Build warnings are
existing legacy server-function deprecations/standard bundler notices, not failed
checks. An exploratory broad Prettier check flagged generated migration JSON style;
those historical/generator-owned files were preserved, and the focused handwritten
check passed. No security check was disabled to obtain these results.

Detailed local logs and Playwright JSON remain in ignored `.local/phase3f-results` and
`.local/browser-report.json`; captures/artifacts are never public. Initial storage tests
that assumed immediate availability were updated to explicitly scan actual fixture bytes.
An initial HTTP 3D fixture cleanup failed on the new scan-history FK; its cleanup was
extended and only the known disposable fixture pair/test scan audits were reconciled.
No production evidence or private real-user material was deleted. Two expired,
unattributed email-verification digest rows remain: no active proof or account is
retained, and no unapproved generic token-retention deletion was performed. The
final audit reports this count explicitly; captured email and browser object counts
are zero.

## 9. Remaining risks and release prerequisites

A clean verdict reduces risk; it is not a guarantee of safe PDFs or legal compliance.
The scanner process, guarded owner, OS/storage owner and protected secrets remain trusted.
Application writes never replace objects. Malicious privileged OS writes after the final
hash check are outside RLS; protect immutable object ownership, ancestors and paired
restoration/inventory controls. Revocation cannot recall already rendered data, transferred
bytes or accepted provider work. Finite provider idempotency needs ambiguity reconciliation.

Before any confidential release: install and validate supported clamd/FreshClam, protected
socket/UTC and inspection/stream limits with safe positive/negative fixtures; monitor fresh
loaded definitions and recovery; approve privacy/retention/hold and investigation ownership;
review production DB/OS roles and least-privilege email workers; provision TLS/proxy limits,
shared rate limiting, capacity/quota controls, worker supervision and alert response;
review/self-host existing remote fonts/crest assets; verify provider deliverability/domain/sender without test mail to real recipients; establish
encrypted paired backups, secret custody and restore drills; complete human/browser/device
accessibility acceptance and incident response. Existing connectors remain deliberately
local-only. No unrestricted confidential readiness or deployment approval is claimed.

## 10. Recommended Phase 4 scope

Plan a separately authorized controlled pre-production operational acceptance phase:
least-privilege host/DB provisioning and email workers; real ClamAV/FreshClam/limit tests;
shared rate limiting; monitoring/supervision and alert drills; deliverability checks;
backup restore/quota exercises; approved privacy/retention/subject-rights/hold decisions;
manual keyboard/assistive-technology and real mobile acceptance. Decide release gates
before any deployment. Chat, Google OAuth, S3 migration and destructive disposal remain
separate scopes. No Phase 4 work was started.

## 11. Complete source file inventory

- `.env.example`
- `.gitignore`
- `README.md`
- `browser/acceptance.spec.ts`
- `browser/fixtures.ts`
- `browser/server.ts`
- `bun.lock`
- `database/authorization.test.ts`
- `database/integration.test.ts`
- `database/migrations/0026_assignment_notification_consistency.sql`
- `database/migrations/0027_document_quarantine.sql`
- `database/migrations/0028_scan_authorization.sql`
- `database/migrations/0029_scan_submission_gate.sql`
- `database/migrations/0030_scan_global_concurrency.sql`
- `database/migrations/0031_infected_scan_evidence.sql`
- `database/migrations/meta/0026_snapshot.json`
- `database/migrations/meta/0027_snapshot.json`
- `database/migrations/meta/0028_snapshot.json`
- `database/migrations/meta/0029_snapshot.json`
- `database/migrations/meta/0030_snapshot.json`
- `database/migrations/meta/0031_snapshot.json`
- `database/migrations/meta/_journal.json`
- `database/phase3c.test.ts`
- `database/phase3d.test.ts`
- `database/phase3e-boundary.test.ts`
- `database/phase3e.test.ts`
- `database/phase3f-notifications.test.ts`
- `database/phase3f.test.ts`
- `database/runtime-grants.sql`
- `database/safety.ts`
- `database/scanner-grants.sql`
- `database/scanner.server.ts`
- `database/schema/index.ts`
- `database/schema/scanning.ts`
- `database/schema/submissions.ts`
- `database/test-scanning.ts`
- `docs/application-settings.md`
- `docs/browser-acceptance.md`
- `docs/database.md`
- `docs/document-scanning.md`
- `docs/operations-monitoring.md`
- `docs/phase-3f-report.md`
- `docs/privacy-retention-readiness.md`
- `docs/reviewer-operations.md`
- `docs/storage.md`
- `docs/submission-lifecycle.md`
- `package.json`
- `playwright.config.ts`
- `scripts/db/document-scans.ts`
- `scripts/db/operations-report.ts`
- `scripts/db/phase3d-smoke.ts`
- `scripts/db/phase3e-audit.ts`
- `scripts/db/phase3f-audit.ts`
- `scripts/db/retention-preview.ts`
- `scripts/db/scanner-setup.ts`
- `scripts/db/storage-inventory.ts`
- `src/components/submissions/SubmissionDetail.tsx`
- `src/lib/documents/service.server.ts`
- `src/lib/operations/health.server.ts`
- `src/lib/operations/health.test.ts`
- `src/lib/operations/inventory.server.ts`
- `src/lib/privacy/preview.server.ts`
- `src/lib/privacy/retention.ts`
- `src/lib/reviews/notifications.server.ts`
- `src/lib/scanning/probe.server.ts`
- `src/lib/scanning/scanner.integration.ts`
- `src/lib/scanning/scanner.server.ts`
- `src/lib/scanning/testing.ts`
- `src/lib/scanning/worker.server.ts`
- `src/lib/submissions/service.server.ts`
- `src/routes/admin.settings.email.tsx`
- `src/server.ts`
- `tsconfig.json`
