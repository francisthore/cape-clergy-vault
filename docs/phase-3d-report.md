# Phase 3D implementation report

Implemented locally on 5 November 2026 (Africa/Johannesburg), on
`feat/self-hosted-migration`. Started with a clean working tree. No commit, push,
merge, deployment, DNS change, provider-console change or real email delivery was
performed. Michael's original conception/development with Lovable remains attributed
in README. Prior implementation reports and historical interfaces informed this work.

## 1. Implementation summary

Email sender configuration now persists in PostgreSQL, has a separate scoped
settings-manager capability, and changes subsequent authentication/notification
payloads without restart. Approved clergy with current consent can save/edit drafts,
attach private PDFs, explicitly submit, view their own items and begin amendments of
returned items. Repository browsing/details expose only accepted, non-confidential
resources and use the existing audited private download flow.

Checkpoint A's settings permission, persistence, concurrency, revocation and dynamic
sender tests passed before submission work began; the existing 33 application tests
also passed. No known authorization regression was carried into Checkpoint B.

The permitted **environment-secret fallback** was selected: no encrypted credential
vault or in-app key/provider replacement is claimed. This limitation is explicit
in the settings UI/runbook. Theological decisions, reviewer onboarding, chat,
OAuth and deployment remain excluded.

## 2. File inventory

| Files                                                                                                               | Purpose                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `database/schema/settings.ts`, `database/schema/index.ts`                                                           | Typed settings, domains, capability, immutable settings history and persistent test reservations                                    |
| `database/schema/submissions.ts`                                                                                    | Draft enum, version/revision/date, retained attachment exclusions, typed lifecycle snapshots                                        |
| `database/schema/approval.ts`                                                                                       | Notification sender/reply-to/recipient retry snapshots                                                                              |
| `database/migrations/0011_*.sql` through `0019_*.sql`                                                               | Additive schema, constrained write functions, RLS/trigger refinements; detailed below                                               |
| `database/migrations/meta/0011_snapshot.json` through `0019_snapshot.json`, `_journal.json`                         | Generated forward migration metadata                                                                                                |
| `database/runtime-grants.sql`                                                                                       | Scoped new function execution; author direct submission INSERT removed; no broad metadata UPDATE/DELETE                             |
| `src/lib/settings/{validation.ts,email.server.ts,service.server.ts,runtime.server.ts}`                              | Validation, per-send resolver, capability/recent-auth HTTP actions and runtime wiring                                               |
| `src/lib/server/http.server.ts`                                                                                     | Bounded JSON input, exact-Origin checks, safe errors and private headers                                                            |
| `src/lib/submissions/{validation.ts,client.ts,service.server.ts,runtime.server.ts}`                                 | Metadata validation, scoped author/lifecycle actions and database-side repository queries                                           |
| `src/lib/email/{service.server.ts,templates.server.ts}`                                                             | Dynamic settings, enabled-state checks, test template, stable retry payload support, test-mode real-provider guard                  |
| `src/lib/approvals/notifications.server.ts`, `scripts/db/approval-notifications.ts`                                 | Delivery-time settings and persisted first-attempt payload snapshots                                                                |
| `src/lib/auth/{service.server.ts,runtime.server.ts,client.ts}`                                                      | Shared database email configuration, live settings capability in account state                                                      |
| `src/lib/documents/service.server.ts`                                                                               | Draft-only owner upload eligibility; original storage/download/audit service retained                                               |
| `src/components/submissions/{SubmissionForm,SubmissionList,SubmissionDetail}.tsx`                                   | Responsive labelled forms, explicit save/confirm, filtering/pages, lifecycle and attachment progress                                |
| `src/routes/api/{settings.email,submissions,repository}.ts`                                                         | Protected server API handlers                                                                                                       |
| `src/routes/admin.settings.email.tsx`                                                                               | Dedicated settings form/status/history/test UI                                                                                      |
| `src/routes/submissions.{index,new,$id}.tsx`, `src/routes/repository.{index,$id}.tsx`                               | Author dashboard/create/details and repository list/details                                                                         |
| `src/routes/_authenticated/repository.tsx` (removed)                                                                | Legacy Supabase repository route replaced by the independent root repository routes                                                 |
| `src/routes/documents.tsx`, `src/routes/account.tsx`, `src/components/SiteHeader.tsx`                               | Coherent navigation; manual-UUID workspace replaced by draft entry point                                                            |
| `src/server.ts`, `src/routeTree.gen.ts`                                                                             | HTML authorization/private headers and generated route registration                                                                 |
| `scripts/db/settings-operator.ts`                                                                                   | Explicit exact-ID manager grant/revoke and independently attested domain/sender authorization                                       |
| `database/phase3d.test.ts`, `scripts/db/phase3d-smoke.ts`                                                           | Restricted PostgreSQL security/workflow suite and real built Node HTTP sequence                                                     |
| `database/{authorization,integration,phase3c}.test.ts`                                                              | Existing fixtures aligned with draft-only writes, new immutable cleanup and ledger/table counts; prior negative assertions retained |
| `package.json`                                                                                                      | Settings operator and Phase 3D test/smoke commands; no new dependency or lockfile change                                            |
| `.env.example`, `README.md`, `docs/{database,storage,application-settings,submission-lifecycle,phase-3d-report}.md` | Configuration, lifecycle, recovery and implementation evidence                                                                      |

Only `.env.example` is tracked. Private environment files, objects, local PostgreSQL
and captures remain ignored. Historical Supabase SQL/source and migrations/snapshots
through `0010` were preserved. No private file is staged or committed.

## 3. Database migrations

| Migration                           | Change                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0011_email_settings`               | Five typed, RLS-enabled settings/capability/domain/history/rate tables                                                                                 |
| `0012_email_settings_security`      | Bootstrap values, capability policies, scoped resolver/save/test functions, immutable history and owner-only manager authorization                     |
| `0013_submission_drafts`            | Draft enum, submission version/revision/timestamp, attachment exclusion and lifecycle table                                                            |
| `0014_submission_workflow_security` | Version-checked draft/transition/exclusion functions, verified identity RLS, serialized upload reservation, draft finalizer and exclusion-aware audits |
| `0015_notification_sender_snapshot` | Durable sender/reply-to/recipient fields for retry payload stability                                                                                   |
| `0016_captured_email_defaults`      | Enabled capture defaults only for untouched bootstrap settings; manager-saved preferences preserved                                                    |
| `0017_review_author_isolation`      | Existing reviewer infrastructure cannot review its author's own work or drafts                                                                         |
| `0018_private_review_notes`         | Reviewer notes restricted to eligible reviewers of another author's submission                                                                         |
| `0019_submission_text_validation`   | Forward whitespace normalization/refinement at SQL author-write boundaries                                                                             |

Twenty migration ledger entries now describe 18 application tables and four generated
Better Auth tables. Every migration is additive/forward; no applied migration was
rewritten. Incremental refinements use new migration files. `db:check` passes,
`db:generate` reports no drift, and guarded migration/grant repetition is safe.
The historical submission default remains submitted for trusted operator compatibility;
web runtime cannot use direct INSERT and its creation function always creates a draft.

Apply with the guarded project-local owner tooling, then `db:runtime:setup`. Never
apply historical `drizzle/migrations`. Back up DB/private volume and protected server
configuration before maintenance. Restore matching backups into isolated capture-only
infrastructure, review grants and inventory before resuming writers. Do not edit the
ledger, mutate immutable history or broaden grants to recover an ordinary conflict.
Full procedures: [database](database.md), [settings](application-settings.md),
[storage](storage.md).

## 4. Settings-management design

A constrained singleton holds domain, display name, from/reply-to, transactional and
optional-notification flags, integer version, updater and timestamp. The service and
SQL function both validate inputs; save uses optimistic concurrency and atomically
appends typed snapshots plus an ID-only audit. No arbitrary configuration JSON/code
or credential belongs in this table. The internal JSON resolver is a typed projection
of constrained columns, not an unvalidated settings registry or public API.

`settings_managers` is independent of roles. Verified identity, approved account and
live non-revoked capability are required on every protected action. Reviewer/admin,
approver and ordinary clergy status do not imply this capability; conversely it
provides no reviewer/approval/confidential-document rights. Runtime cannot call its
owner-only grant function. The interactive operator tool requires an exact verified,
approved identity ID and exact confirmation, never automatic email matching.
Grant/revoke events are audited. No real privileged fixture is left behind.

Saves/tests additionally require authentication within 15 minutes. Invalid/future
session dates fail closed. Stale edits return 409; there is no implicit merge.
The test action has no recipient field, derives the verified manager address, reserves
a persistent per-manager one-minute limit and audits before I/O. Capture and provider
acceptance are labelled separately from recipient delivery. No broadcast feature exists.

## 5. Resend configuration approach

Initial values are proposals: sending domain `notifications.ctdiocese.org.za`, sender
`notifications@notifications.ctdiocese.org.za`, display name `Cape Clergy Vault`.
The domain's verification is user-reported, not independently verified. No DNS or
external Resend configuration was accessed. Before live delivery, the trusted
operator must inspect provider evidence, confirm the exact sender and explicitly
attest the domain through the interactive tool. Extra domains require that procedure;
a database boolean or environment flag alone is not verification evidence.

Auth verification/password recovery and the notification worker resolve PostgreSQL
settings for each send. Sender domains never determine links: trusted
`BETTER_AUTH_URL` remains authoritative. Both HTML/plain text templates and bounded
provider retries remain. External provider I/O never runs in a DB transaction.

Pending outbox items resolve settings at delivery time. At first payload preparation,
sender, reply-to and recipient are durably frozen on that intent, with the existing
idempotency key, so later retries cannot silently change the provider payload.
New messages use current configuration immediately. Disabled/missing/invalid
configuration fails safely, leaving bounded retry/recovery evidence. Provider
acceptance and finite idempotency retention do not guarantee inbox receipt.

Local delivery defaults to private capture. Untouched initial flags permit capture
registration before a manager exists; real delivery still needs server provider/key
opt-in and protected domain authorization. Saved enabled/disabled preferences work
in both modes. Automated test mode cannot select real Resend delivery, and new
integration/HTTP tests explicitly forbid external fetch.

## 6. Secret-management design and limitation

The brief's permitted fallback keeps `RESEND_API_KEY` in protected server environment
configuration. No secret field, credential GET response, HTML serialization, log,
fixture credential or browser credential bundle was added. Sender/reply-to/enable
changes need no restart; API-key/provider replacement still requires protected
operator configuration and process reload. The UI states this limitation.

An encrypted credential vault, write-only replacement action, master-key custody,
versioned key rotation and recovery are not implemented. They require a separately
reviewed design; no invented encryption or plaintext database downgrade was used.
Back up provider/auth/runtime credentials separately with encryption and restricted
operator access, never in source/DB dumps/captures/reports. Test restores without
live delivery. A trusted process compromise remains outside at-rest protection.

Acceptance criterion 4 is met through the explicitly allowed fallback. The preference
for routine in-app credential/provider replacement remains deferred; this is not a
claim that encrypted credential management was completed. No other Phase 3D
acceptance criterion is intentionally left incomplete.

## 7. Submission lifecycle

Authors create and explicitly save drafts. Type is fixed at creation; metadata is
bounded and categories reuse the original interface. Final submission requires a
meaningful description; document submissions additionally require an available PDF
and no active pending/failed attachments. Ideas need no PDF. IDs/ownership/status are
server-derived, not trusted form fields. SQL functions row-lock and compare versions;
competing saves/submissions have one winner with clear stale-form errors.

Draft → submitted locks ordinary metadata and uploads. Under-review/accepted states
cannot be author-edited. Returned → amendment draft increments revision, retains a
pre-amendment snapshot and all review decisions, and subsequently produces a new
submitted snapshot. No accept/return decision handler is provided. Snapshots retain
metadata and included attachment IDs. Settled attachments may be explicitly excluded
on a draft, preserving bytes/metadata; pending ones must finish/fail first.

Existing submitted local rows are not silently reopened. Ordinary author direct
INSERT is revoked, and no broad direct metadata UPDATE/DELETE is granted. Existing
reviewer infrastructure is narrowed to deny self-review/draft review and private
note leakage. Author details show only lifecycle events, never private reviewer notes.
See [lifecycle details](submission-lifecycle.md).

## 8. Repository and document integration

PostgreSQL applies eligible-session RLS plus explicit accepted/non-confidential
predicates before search, category/keyword/status filters, total counts and 20-row
pages, even for reviewer callers. Counts and page data share a statement snapshot,
including out-of-range pages. Stable ordering is creation timestamp/UUID; offset
pages may shift when the collection changes. No private facets, suggestions, external
index or client-side privacy filtering exist. Details use explicit projections and
omit author-only history and excluded/unavailable attachments.

My Submissions is separately owner-scoped at the server. PDF uploads start from draft
details with progress/cancel/state feedback; the manual UUID workspace is retired.
A short reservation SHARE lock serializes against final submission's UPDATE lock;
finalization rechecks draft state after I/O. Original private provider, signature/
trailer/size/hash checks, safe filesystem controls and download endpoints remain.
Required authorization/start audits commit before any bytes; no public URL is added.

Private HTML gates run before rendering, APIs/pages are no-store, lists/details
recheck while open, and the PWA still only caches static assets. Editing preserves
unsaved input while probing live permissions. No offline auth/private-data cache or
unrelated branding redesign was introduced.

## 9. Security model and limits

All authorization tests use the actual restricted PostgreSQL runtime login and real
Better Auth sessions. Owner connections appear only in guarded operator/worker tools
and disposable fixture setup/teardown. SECURITY DEFINER functions have fixed
`pg_catalog` search paths, qualified objects and no PUBLIC execution. Internal
snapshot/trigger/operator helpers are not granted to runtime. Existing append-only
history triggers and no-DELETE/no-DDL/runtime isolation remain.

Database context is still a trusted-server boundary, not a cryptographic identity
claim: runtime credential theft, SQL injection or a compromised trusted process is
outside that boundary. In-flight operations/previously viewed metadata or started
transfers cannot be recalled by later revocation. Server-source EOF is not delivery
proof. Provider failures, immutable audit outages and private storage errors retain
the prior failure/reconciliation behavior rather than bypassing authorization.

## 10. Validation commands and results

| Command/check                                                  | Result                                                                                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run typecheck`                                            | Passed                                                                                                                                                           |
| `bun run test`                                                 | 8 files / all 33 existing tests passed                                                                                                                           |
| `bun run db:test:unit`                                         | 3 safety tests passed                                                                                                                                            |
| `bun run db:test`                                              | 3 integrity/history tests passed; updated ledger/table assertions                                                                                                |
| `bun run db:test:auth`                                         | 10 restricted-role/RLS/context/Better Auth tests passed                                                                                                          |
| `bun run db:test:phase3a`                                      | 12 authentication/registration tests passed                                                                                                                      |
| `bun run db:test:phase3b`                                      | 17 approval/outbox/capability tests passed                                                                                                                       |
| `bun run db:test:phase3c`                                      | 18 private-storage/audit/failure tests passed                                                                                                                    |
| `bun run db:test:phase3d`                                      | 10 tests including parent passed; actual runtime and live sessions                                                                                               |
| `bun run build`                                                | Passed client, SSR, Node and PWA build                                                                                                                           |
| `bun run db:smoke:phase3a`                                     | Built Node HTTP auth regression passed                                                                                                                           |
| `bun run db:smoke:phase3b`                                     | Built Node HTTP approval regression passed                                                                                                                       |
| `bun run db:smoke:phase3c`                                     | 11 built Node HTTP storage tests passed                                                                                                                          |
| `bun run db:smoke:phase3d`                                     | Full built Node HTTP sequence and security smoke passed                                                                                                          |
| `bun run db:check`; `bun run db:generate`                      | Passed; no schema drift                                                                                                                                          |
| `bun run db:migrate`; `bun run db:runtime:setup` and repeat    | Passed guarded additive apply/repeat; existing credentials retained                                                                                              |
| `bun run storage:inventory --verify`                           | Zero documents, findings, temporary or unknown objects after fixture cleanup                                                                                     |
| Focused ESLint on changed TS/TSX modules and tests             | Passed with no warnings                                                                                                                                          |
| Focused `bunx prettier --check` on changed source/docs/package | Passed                                                                                                                                                           |
| Applied migration content and cleanup audit                    | All 20 migration hashes match ledger; zero retained fixture identities/managers/submissions/documents/history/notifications/audits; application triggers enabled |
| `git diff --check`                                             | Passed                                                                                                                                                           |
| Tracked environment/history checks                             | Only example env tracked; historical SQL/Supabase artifacts unchanged                                                                                            |
| Configured-secret scan of `.output/public`                     | 47 public JS/HTML/JSON/map artifacts checked; no configured auth/email/runtime secret values found                                                               |
| Browser/device/accessibility E2E                               | Not performed; HTTP tests do not claim a browser engine                                                                                                          |

New coverage includes settings isolation/grant/revoke/recent authentication,
forged-field denial, disabled flags/domain attestation, persisted/concurrent settings,
dynamic auth sender and durable retry snapshots, own-draft validation/isolation,
no forged owner/status, idea/document requirements, competing submissions, normalized
whitespace, reviewer self-approval denial, upload state/exclusion/finalization,
returned revision integrity/private-note denial and repository counts/pages/search
across capabilities and consent/account revocation. Direct and built HTTP sequences
exercise registration → verification → approval → draft → PDF → submit → own list.
Accepted/confidential discovery uses explicitly authorized disposable owner fixtures,
not a fake production review workflow. No live Resend requests occur.

A recent-auth negative test exposed a test-fixture timezone mismatch: generated auth
timestamps are timezone-free UTC, whereas owner `now()` used local timezone. Fixtures
now explicitly use UTC, and the service also rejects invalid/future dates. A direct
non-reviewer UPDATE correctly affects zero RLS-visible rows rather than raising an
exception; the negative test asserts that denial accurately. Final tests pass.

## 11. Outstanding launch dependencies

- Reviewed POPIA notice/version/retention policy and authorization for real
  confidential material; current notice remains an unapproved local draft.
- Durable malware scanning/quarantine and stronger PDF validation. Existing checks
  are not a guarantee of file safety; use disposable documents only.
- Production identity/role/connectors, TLS/proxy limits, dedicated private storage,
  backups/restore drills, capacity/quotas, monitoring, shared abuse limits and dedicated
  least-privilege production notification worker/scheduling. Local guards remain.
- Confirm exact live sender and provider evidence/deliverability; authorize domains
  deliberately. Capture is tested, real Resend delivery is not.
- Separate encrypted credential/provider-management design if in-app rotation is
  required. Environment-secret fallback is the current explicit limitation.
- Real browser/mobile/keyboard/screen-reader acceptance testing and eventual
  search/index performance work at realistic scale.

No production readiness, deployment or unrestricted confidential uploads are claimed.

## 12. Recommended Phase 3E scope

Separately specify reviewer identity/mailbox-proof onboarding and atomic theological
review transitions, including private versus author-facing comments and immutable
revision decisions. Build on this draft/repository/storage boundary. Review the
credential vault/key-custody design separately if prioritized; complete privacy,
scanning and browser acceptance prerequisites before confidential launch. Chat,
OAuth, S3 and production deployment remain separately scoped.

The project-local PostgreSQL cluster was stopped after validation, with its data
retained. Stop at Phase 3D. All changes remain local and uncommitted for review.
