# Phase 3C implementation report

Implemented locally on **5 November 2026**, Africa/Johannesburg, on
`feat/self-hosted-migration`. Started with a clean working tree on that tracking
branch. No commit, push, merge, history rewrite, deployment, VPS change, production
migration, external Supabase connection or real Resend delivery was performed.
Michael's original concept/development and Lovable attribution are preserved.

## 1. Executive implementation summary

Private PDF uploads and authenticated streamed downloads now work locally with
Better Auth 1.7.16, the restricted PostgreSQL runtime role, existing consent/role
RLS, private filesystem objects and mandatory pre-transfer auditing. A scoped
`/documents` workspace exercises storage against an existing authorized submission;
it does not implement submission creation, theological review or repository browsing.

PDF is the justified initial allowlist, with a configurable downward limit and hard
ceiling of **20 MiB**. The legacy UI's PDF/DOC/DOCX/ODT/TXT/RTF client allowlist and
25 MiB limit were reviewed and deliberately replaced for this separate flow. Office
container and legacy formats require dedicated validators. Browser MIME/extension
checks never establish server content validity.

This is a locally testable storage foundation, not deployment approval. PDF detection
is bounded signature/trailer validation, not full parsing, sanitization or malware
scanning. Production release dependencies and remaining trust limits are explicit
below and in the [storage architecture/runbook](storage.md).

## 2. Files added and modified

| Files                                                                           | Purpose                                                                                                                |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/lib/documents/storage.server.ts`                                           | StorageProvider/read handle, private local provider, bounded save/hash/validation, safe opens, configurable storage    |
| `src/lib/documents/service.server.ts`                                           | Session/consent/parent authorization, document lifecycle, metadata projection, audits and download streaming           |
| `src/lib/documents/runtime.server.ts`                                           | Server-only lazy integration with existing Better Auth/runtime connection                                              |
| `src/lib/documents/storage.test.ts`                                             | Six filesystem security tests with private temporary directories                                                       |
| `src/routes/api/documents.ts`                                                   | GET list and POST raw upload server handlers                                                                           |
| `src/routes/api/documents.$documentId.download.ts`                              | Authenticated GET streaming handler                                                                                    |
| `src/routes/documents.tsx`                                                      | Minimal existing-submission document test workspace, progress/cancel/error/list/download UI                            |
| `src/routes/account.tsx`, `src/server.ts`, `src/routeTree.gen.ts`               | Account entry link, private-page no-store headers, generated route registration                                        |
| `src/lib/auth/service.server.ts`                                                | Optional verified-session-derived database boundary for constrained denial audit/recovery; no client-supplied identity |
| `database/schema/{submissions,audit}.ts`                                        | Lifecycle/idempotency constraints and document audit identifier                                                        |
| `database/migrations/0008_document_lifecycle.sql`                               | Additive schema changes                                                                                                |
| `database/migrations/0009_document_security.sql`                                | Tightened document RLS and constrained finalize/fail/audit functions                                                   |
| `database/migrations/0010_document_object_keys.sql`                             | Forward refinement separating private object keys from public document IDs                                             |
| `database/migrations/meta/{0008,0009,0010}_snapshot.json`, `_journal.json`      | Generated additive snapshots/journal                                                                                   |
| `database/runtime-grants.sql`                                                   | Four explicitly scoped function EXECUTE grants; no new broad table permissions                                         |
| `database/phase3c.test.ts`                                                      | Real runtime-role integration suite and optional built Node HTTP mode                                                  |
| `database/{authorization,integration}.test.ts`                                  | Existing fixtures aligned with pending/available lifecycle; ledger count updated, security assertions retained         |
| `scripts/db/storage-inventory.ts`                                               | Guarded read-only inventory and optional streamed SHA-256 verification                                                 |
| `package.json`                                                                  | `db:test:phase3c`, `db:smoke:phase3c`, `storage:inventory` commands                                                    |
| `.env.example`, `README.md`, `docs/database.md`, `docs/storage.md`, this report | Server-only configuration, architecture, local test path, recovery and operational documentation                       |

No new dependency or lockfile change was required. Existing `.gitignore` already
protects `.local/`, temporary objects and root/nested environment files; only
`.env.example` is tracked. Historical Supabase source, original migrations and
snapshots through `0007`, auth setup, administrative bootstrap and PWA configuration
are unchanged.

## 3. Database migrations

Three forward-only migrations were generated/reviewed/applied to the guarded local
test cluster. No applied SQL was rewritten. `0008` adds `documents.state` and
`upload_request_id`, unique `(submission_id,upload_request_id)`, state/available
completeness checks, and FK-free `audit_events.document_id`. `0009` adds verified-email
and current-consent document eligibility, owner-only pending/failed metadata visibility,
zero-size pending INSERT checks, finalization/recovery and constrained audit append.
`0010` replaces the temporary document-ID/object-key equality policy with independently
generated UUIDv4 object keys so document API IDs never disclose provider keys.

Existing rows remain pending and unavailable; no legacy file is automatically migrated
or promoted. The existing documents-parent FK, private metadata, checks and unique
storage key remain. Twelve app tables/four generated auth tables remain, with eleven
migration ledger entries. Drizzle reports no schema drift and the journal check passes.

Runtime retains RLS-limited pending INSERT and no direct document UPDATE/DELETE.
Added EXECUTE grants are only `document_account_allowed`, `finalize_document`,
`fail_document`, and `record_document_access`. Helpers use SECURITY DEFINER only for
fixed purposes, pg_catalog search paths, qualified objects, no dynamic SQL and no
PUBLIC execution. Web requests never import the owner connector.

## 4. Storage architecture

`StorageProvider` saves a bounded request stream, opens a bounded read handle and
deletes an exact validated key. It carries no user/role/parent authorization. The
local provider writes private `UUID.part` and `UUID.blob` objects under ignored
`.local/storage` or the configured private root, never under static assets.

Server-generated UUIDv4 document IDs and object keys are independent. Names are
metadata only. The provider checks root ownership/mode and every ancestor, rejects
symlinks, uses O_EXCL/O_NOFOLLOW, validates regular files and link count, and checks
file mode/owner. Publication uses a same-volume atomic hard link that cannot replace
an existing object, followed by unlink/fsync. Directory mode is 0700 and file mode 0600. No storage key or absolute path is returned to clients or included in logs.

The interface permits a later private S3-compatible provider without changing RLS
or business authorization. That provider must preserve conditional writes, validation,
stream bounds and cancellation; no S3 SDK or signed URL is added here.

## 5. Upload flow

`POST /api/documents?submissionId=UUID&requestId=UUID` accepts one raw PDF body,
encoded filename header and exact trusted Origin. A live verified Better Auth session,
approved profile, current repository consent and owned **submitted document** parent
are required. Pending/rejected/suspended/unverified/unconsented users and other owners
are denied. Reviewers have no special upload-to-another-owner permission.

Strict metadata validation rejects forged extra query fields and bad filenames.
Byte counting enforces the configurable cap even without Content-Length. A private
pending row is reserved first; slow body writes hold no database transaction.
Signature/trailer validation, streaming SHA-256, fsync and exclusive publication
precede a fresh session check and short constrained finalization transaction. That
transaction locks the parent and rechecks editability/consent before publishing
available metadata. Owner/status/confidentiality are never changed by uploads.

Failures normally fail the known pending row and remove its object. Cancellation,
stream errors, disk failure and validation errors cannot publish an available row.
If finalization/recovery is uncertain, retain the private known object/row and log only
its document ID. Available rows survive a lost commit acknowledgement. Duplicate
request UUIDs return 409 without another file; different intents cannot overwrite.

## 6. Download flow

`GET /api/documents/UUID/download` validates input, derives session identity, checks
live eligibility and resolves the row through RLS. It requires available state,
a committed authorization audit, safe filesystem open and matching byte size. A
second required audit rechecks live eligibility/visibility after open and commits
before bytes transfer. If either audit fails, no protected bytes are read/sent;
opened handles are closed.

The response reads at most 64 KiB per pull with backpressure. EOF, failure, request
abort and body cancellation close the handle. Content-Length mismatch fails safely;
client errors reveal no SQL, paths or storage key. Responses use attachment with
safe RFC 5987 filenames, PDF Content-Type, private/no-store, Cookie variation,
nosniff, no-referrer and a sandbox CSP. No public/static download or token route exists.
The existing PWA caches static assets only, with no API/navigation caching.

## 7. Authorization model

Document metadata/bytes follow parent submission RLS plus a verified-email check:

| Caller                                                                                  | Access                                                                                    |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Approved verified owner, current repository consent                                     | Own available files; own pending/failed metadata; upload to own submitted document parent |
| Other approved verified clergy, current consent                                         | Available accepted, non-confidential documents                                            |
| Live approved reviewer/admin, current consent                                           | Review-authorized available documents including confidential submissions                  |
| Approver alone                                                                          | Ordinary owner/shared-clergy permissions only; no confidential/reviewer privilege         |
| Anonymous, pending, rejected, suspended, unverified, missing/withdrawn/obsolete consent | No protected bytes                                                                        |

Revoked reviewer roles affect later requests. Author-set confidentiality is preserved.
Returned/under-review/accepted parents cannot accept uploads because there is no draft
state in the existing schema; later submission workflow design must address amendments
explicitly. No reviewer provisioning, mailbox challenge, review decision or role
administration was added. Existing isolated Supabase routes cannot access new local
objects; no old bucket/key is used by the new flow.

## 8. Audit implementation and semantics

Each request has a fresh server correlation UUID. ID-only events distinguish denied,
unavailable, authorized, open_failed, started, transfer_failed, cancelled and
stream_ended. Malformed document IDs can append a denial without storing invalid input.
Hidden existing files use denial semantics; missing/visible unfinished files use
unavailable semantics, with identical safe missing/access-denied client responses.

The constrained audit helper accepts only event/document/correlation, derives actor
from the trusted session boundary, resolves parent internally and determines outcome.
It permits anonymous/inactive denial recording without general privileged INSERT.
Existing immutable history triggers and runtime permission restrictions remain.
Authorized/start audits commit before bytes and fail closed. Terminal observations
are best effort after transfer starts; later audit failure logs only correlation ID.

Started means opened and ready to transfer. Stream-ended means server-source EOF,
not proof of delivery, saving or reading. Process death can leave no terminal event.
Each retry has its own correlation; no false completed-download event is created.
A compromised runtime can falsify appended claims; immutability protects existing
history, not the truth of a malicious server's new statements.

## 9. Validation and security results

All database tests use the existing guarded loopback cluster
`127.0.0.1:55432/cape_clergy_vault_dev`. Security operations use the real
`cape_clergy_runtime` login; owner access is fixture/tooling-only. Temporary storage
and generated disposable users/submissions are removed after tests. External fetch
is forbidden in new integration tests and in the built HTTP child; real mail keys
are overridden, and no external Supabase or Resend access occurs.

| Command/check                               | Result                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `bun run typecheck`                         | Passed                                                                                                                             |
| `bun run test`                              | 8 files, 33 tests passed, including 6 new filesystem tests and existing email/PWA/application tests                                |
| `bun run db:test:unit`                      | 3 safety tests passed                                                                                                              |
| `bun run db:test`                           | 3 integrity/history tests passed; eleven ledger entries                                                                            |
| `bun run db:test:auth`                      | 10 restricted-role/RLS/auth/context tests passed                                                                                   |
| `bun run db:test:phase3a`                   | 12 authentication/registration tests passed                                                                                        |
| `bun run db:test:phase3b`                   | 17 approval/outbox/role-isolation tests passed                                                                                     |
| `bun run db:test:phase3c`                   | 18 tests passed, including parent; real sessions/runtime permissions and injected failures                                         |
| `bun run build`                             | Passed client, SSR, Node and PWA builds                                                                                            |
| `bun run db:smoke:phase3c`                  | 11 tests passed, including parent; real built Node HTTP login/upload/list/download/denial/sharing and static-path/legacy isolation |
| `bun run db:check`, `bun run db:generate`   | Passed; no schema drift                                                                                                            |
| Guarded migrate/runtime-grant repeat        | Passed; existing credentials retained, no broader table grants                                                                     |
| `bun run storage:inventory --verify`        | Zero documents/findings/temporary/unknown objects after cleanup                                                                    |
| Focused ESLint/Prettier, `git diff --check` | Passed                                                                                                                             |
| Fixture/security-artifact check             | App/auth fixtures empty, application triggers enabled, private config absent from public build                                     |
| Historical-source/environment check         | Earlier SQL/snapshots/Supabase source unchanged; only example env tracked, private files ignored                                   |
| Browser E2E/device testing                  | Not performed; HTTP tests are not browser/device E2E                                                                               |

Coverage includes all inactive account states, missing/withdrawn consent, ownership,
accepted/confidential sharing, approver isolation, live reviewer revocation, forged
query IDs/roles/keys, bad/empty/mismatched/oversized files, traversal, symlink ancestors/
leaves/temporary paths, hard links, restrictive permissions, concurrent/duplicate
requests, partial upload cleanup, absent/unsafe objects, disk failures, mid-upload
consent changes, failed/ambiguous DB outcomes, both pre-transfer audit failures,
source streaming failure, cancellation/abort, immutable evidence and bounded reads.
A real 2 MiB file passes both direct and built HTTP transfer checks. The project-private
PostgreSQL cluster was stopped after validation, with schema/data retained.

Tests exposed an RLS interaction: SELECT FOR SHARE in the ordinary-owner reservation
lookup also applied the reviewer UPDATE policy and returned no row. Removed that
unnecessary initial lock; the short SECURITY DEFINER finalizer still locks/rechecks
the parent. Also corrected a mixed-case disposable email fixture and Node strip-only
TypeScript parameter properties. No authorization was weakened to make tests pass.
A cleanup audit caught a delayed cancellation event after fixture deletion; teardown
now waits for that terminal audit and drains runtime work before deleting fixtures.
Only the exact identified test event was removed, with immutable triggers restored.
Only local socket operations needed reviewed sandbox execution. Existing build notices
about TanStack inputValidator/vite-tsconfig-paths remain unrelated.

## 10. Recovery strategy

The [full storage runbook](storage.md) covers matching DB/filesystem backups, ownership,
capacity monitoring, disk/inode limits, integrity checks, failed uploads and consistent
restores. `storage:inventory [--verify]` performs read-only reconciliation and hash
checks. It reports stale pending rows and unsafe/missing/size/hash findings by ID,
and counts unknown names without printing them.

After a crash, stop writers, preserve both backups, inventory, verify the exact row
and generated key, then deliberately fail a still-pending row in a short locked
operator transaction. Only confirmed failed known objects can be removed after
rechecking with writers stopped. Never delete unknown files or promote a blob merely
because it exists. Restore missing available bytes from a matching verified backup,
or keep them unavailable for operator review. No destructive cleanup job was added.

## 11. Remaining risks and operational dependencies

- No malware scanner, CDR or full PDF parser is installed. PDFs can contain active
  or malicious reader content; add durable quarantine/scanning while pending before
  real confidential use. DOCX/other formats remain rejected until validated safely.
- Production roles/connectors, TLS, reviewed POPIA wording, backups/restore drills,
  monitoring, capacity/retention/quotas, global concurrency/abuse limits, trusted proxy
  settings and prior-phase release requirements remain. Local database guards
  intentionally refuse arbitrary production targets. No services/VPS were modified.
- Root ancestors and the OS runtime owner must be trusted. O_NOFOLLOW and ancestor
  checks do not defeat concurrent directory replacement by that same privileged OS
  owner; portable directory-fd/openat2 protection is not supplied by this provider.
- Rechecks minimize permission-change races but cannot recall already-started bytes.
  There is no long transaction or per-chunk database lock. Terminal audits can be
  absent after process death or a later database outage; EOF cannot attest receipt.
- Validation uses bounded buffers, but application/proxy total concurrency and disk
  capacity need operational limits. Failed metadata is retained; stale/unknown
  reconciliation is deliberate operator work, never automatic arbitrary deletion.
- The minimal workspace needs an existing disposable authorized submission UUID.
  Theological submission/review/repository/chat/OAuth workflows remain incomplete.
  Browser/device/accessibility acceptance tests and production scanning are pending.

## 12. Recommended next phase

Plan the self-hosted submission workflow and repository browsing on this storage/RLS
foundation: owned editable submissions, explicit amendment rules, document management
and safe accepted-resource discovery. Keep reviewer mailbox-proof provisioning,
theological decisions, chat and production operations separately reviewed. Resolve
privacy/scanning/release dependencies before real confidential material. Phase 3C
stops here; no next phase, commit, push, merge or deployment was started.
