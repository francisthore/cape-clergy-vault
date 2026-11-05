# Private documents: Phase 3D integration

This local implementation uses Better Auth, PostgreSQL RLS and private filesystem
storage. It does not use Supabase Storage. The original Lovable workflow is retained
as isolated historical code; its six client-validated formats (PDF, DOC, DOCX, ODT,
TXT, RTF) and 25 MiB limit are not the new server's security policy. Michael's
conception and original development remain attributed in the README.

## Configuration and operator setup

Server-only variables are documented in `.env.example`. Default `CAPE_STORAGE_ROOT`
is ignored `.local/storage`; `CAPE_STORAGE_PROVIDER=local`,
`CAPE_MAX_UPLOAD_BYTES=20971520`, `CAPE_DOCUMENT_TYPES=pdf`. The byte limit can be
reduced, never raised beyond 20 MiB in this phase. Unsupported provider/type settings
fail closed. Do not use VITE variables for server configuration. Only `.env.example`
may be tracked, including in nested directories.

Run the established local database startup, migration and runtime-grant commands
before starting the app. Migrations/startup never create real privileged users.
Use `/account` → **My submissions** → **Create a draft**. Save a document draft,
open its details, attach a disposable PDF, inspect its state, then explicitly confirm
submission. No operator-created parent or manually entered UUID is needed. Ideas
can be submitted without a PDF. `/documents` is a navigation entry to this workflow.
Only owned **draft** document submissions can accept uploads. Existing submitted
rows remain locked; no old row is silently changed into a draft. Returned items use
an explicit amendment action, retaining review and attachment history.

The detail view lists at most 100 authorized documents, shows upload progress and
cancellation, and uses the original authenticated streaming download endpoint.
Excluded files remain privately retained for immutable history; they are absent from
shared metadata/downloads and final-submission requirements. Owners may still access
retained available bytes through the protected endpoint. Exclusion is allowed only
for settled attachments on an owned draft; pending work must finish/fail first.
No offline private response caching is configured.

For automated disposable accounts/submissions use `bun run db:test:phase3c` and,
after `bun run build`, `bun run db:smoke:phase3c`. Both remove their own fixtures.

Future production: provision a persistent dedicated directory, e.g.
`/var/lib/cape-clergy-vault/storage`, configurable rather than hardcoded. Own it with
the dedicated unprivileged PM2 runtime account; directory mode **0700**, files **0600**,
umask **0077**. Do not share its owner account with untrusted processes. Ancestors
must be trusted, stable directories and contain no symlinks. Local provider rejects
symlink ancestors, weak root permissions, a wrong UID, public/dist/.output/node_modules
path components, nonregular files, hard links and leaf symlinks. It uses O_NOFOLLOW,
exclusive creation and nonblocking opens before fstat. Keep the directory outside
deployment releases so deploy/rollback never removes it.

Nginx must proxy `/api/` to Node and serve static assets **only** from the build's
public directory; never alias/root the storage directory or repository root. Deny
dotfile locations, disable directory listing, impose upload time/concurrency/body
limits, and allow enough download time. The raw file-body limit is 20 MiB, with no
multipart overhead. Do not cache document or account endpoints. No production
Nginx/PM2/VPS configuration is installed by this phase.

## Boundaries and request protocol

`StorageProvider` has save/open/delete operations, returns byte size/SHA-256 and
bounded read handles, and knows nothing about accounts or RLS. A future S3-compatible
provider must preserve private access, bounded streaming, conditional create,
no-overwrite publication, cancellation and close semantics. `DocumentService`
coordinates live authorization, lifecycle and audit. PostgreSQL remains the source
of truth for approval, roles, consent, parent visibility and document availability.

- `POST /api/documents?submissionId=UUID&requestId=UUID`: raw PDF body,
  `Content-Type: application/pdf`, `X-Document-Name: encodeURIComponent(filename)`,
  exact configured Origin and Better Auth cookie. No user IDs, roles, paths,
  confidentiality or status are accepted. Unknown query properties are rejected.
- `GET /api/documents?submissionId=UUID`: authorized parent check and explicit safe
  metadata projection; storage keys and hashes are never returned.
- `GET /api/documents/UUID/download`: approved/verified/current-consent session,
  available row under RLS, safe open, size check, required audits and stream.

Mutations require same-origin cookies plus exact Origin. Every protected operation
checks a fresh DB-backed Better Auth session with cookie caching disabled. RLS checks
verified email, approved profile, latest current repository consent, ownership and
parent state. Upload requires an owned **draft document** parent.
A reservation trigger takes a short parent SHARE lock to coordinate with final submission;
finalization rechecks/locks the parent after I/O. Returned items must explicitly start
an amendment before attaching files. Submitted/under-review/accepted items are locked. Parent owner, review status and confidentiality are never
changed by document requests. RLS preserves owner access, reviewer/admin access and
accepted **non-confidential** sharing. `approver` grants no theological review access.
Reviewer provisioning/mailbox verification remains outside this phase.

## Validation and layout

PDF alone is the initial allowlist. Office packages require reliable ZIP/container
inspection, decompression bounds and content validation; legacy DOC/RTF and scripts
need separate validators. TXT/ODT have not been silently permitted. Both a safe `.pdf`
name and declared PDF media type are required, plus detected `%PDF-1.0`–`%PDF-1.7` or
`%PDF-2.0` at byte zero and `%%EOF` at the end. The detector reads bounded prefix/tail
buffers; it is **not a full PDF parser or malware scanner**. Empty, oversized,
wrong-signature and truncated-marker files fail. Names are normalized, limited to
180 UTF-8 bytes and reject separators, control/bidi characters and unsafe punctuation.
Names never become paths. Multipart/general archive bodies are not accepted.

The private flat directory contains only server UUIDv4 keys:

```text
UUID.part   exclusive temporary upload
UUID.blob   atomically published immutable object
```

Uploads count bytes while streaming, hash incrementally, use partial-write-safe
64 KiB-scale filesystem operations, and have a five-minute request deadline. Filename,
media type and size supplied by the browser cannot establish content validity.
Downloads read at most 64 KiB per pull, respect backpressure, and close on EOF,
source error, response cancellation or request abort. Metadata size mismatch fails
before transfer; shrink/growth during streaming fails the stream. Headers use attachment,
safe RFC 5987 filename encoding, PDF Content-Type, private/no-store, nosniff,
no-referrer, sandbox CSP and Cookie variation. There is no Range/resume or HEAD byte
endpoint, public static URL, token or arbitrary-path endpoint.

Untrusted PDFs can still contain scripts, embedded attachments or malicious reader
exploits. Attachment delivery and headers do not sanitize those contents. Before
real confidential use, add a scanning/CDR stage while **pending**, with a durable
quarantine/scanning verdict; only a clean verdict should permit finalization. A
scanner outage must leave the file unavailable. Antivirus alone cannot prove safety.

## Filesystem/database consistency

1. Authenticate and validate metadata. Reserve a pending row with generated document
   UUID and independent object UUID/key, parent FK and unique `(submission_id,upload_request_id)` under RLS.
2. Write the exclusive private `.part`; count, hash and validate. No DB transaction
   stays open during network I/O.
3. fsync the completed file, hard-link to `.blob` with no overwrite, unlink `.part`,
   and fsync the directory. File and temporary object stay on the same filesystem.
4. Revalidate the session; constrained `finalize_document` locks the parent against
   concurrent status changes, checks live consent/ownership/draft state, and
   changes pending metadata to available with nonzero size and checksum.
5. On failure call owner-scoped `fail_document`. Delete only a **confirmed failed**
   row's generated final key. It never demotes an available row. If DB outcome or
   recovery authorization is uncertain, retain the file/row and emit an ID-only
   reconciliation-required log. This handles a lost successful commit acknowledgement.

Runtime can INSERT only valid pending records through RLS, cannot UPDATE documents,
and receives EXECUTE only on constrained finalize/fail/audit helpers. It has no app
DELETE, audit mutation, ownership, DDL or bypass-RLS privilege. No file bytes or public
URLs are stored in PostgreSQL. Existing pre-Phase-3C document rows become pending;
there is no automatic promotion or legacy Supabase-object migration.

Duplicate request UUIDs get 409 and cannot write another file. Refresh the list after
uncertain transport outcomes; retries reuse the UUID. A new selection begins a new
intent. This prevents overwrite/duplicate intent records; it does not deduplicate
identical bytes intentionally uploaded with different request IDs.

## Audit semantics

Each download request has a fresh server correlation UUID, returned on successful
streams as X-Request-ID. Events carry actor ID (or null), document ID, parent ID,
correlation, action and outcome, never filenames, paths, contents, tokens or email.

| Event suffix    | Meaning                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| denied          | Ineligible account or existing document hidden by permissions            |
| unavailable     | Missing document or visible pending/failed document                      |
| authorized      | Available row passed live permission checks                              |
| open_failed     | Missing, unsafe or wrong-size filesystem object                          |
| started         | Object opened and live authorization rechecked; server ready to transfer |
| transfer_failed | Observable read/length/stream failure                                    |
| cancelled       | Observable request abort or response-body cancellation                   |
| stream_ended    | Server source reached EOF at the expected length                         |

`authorized` and `started` commit **before bytes**; failure prevents protected transfer.
The fixed-purpose SECURITY DEFINER audit function validates event names, derives actor
from the trusted session boundary, resolves parent internally, and rechecks eligibility
for authorized/started. It allows anonymous/inactive denial append without granting
unrestricted audit writes. Normal immutable history triggers/grants remain intact.
It does not reveal whether a hidden document exists in client responses.

Transfer terminal events are best effort after bytes have started. A DB outage at
that point cannot retract transferred bytes; log correlation-only failure and alert
operators. A process kill can leave a started event with no terminal event. EOF does
**not** prove network delivery, receipt, saving or reading; no event claims completed
download. Retried requests produce separate correlated attempts, not one fabricated
completion. Existing generic runtime audit append is retained for other workflows;
immutable rows cannot prove the truth of a compromised server's claims.

## Operations, backup and recovery

Monitor private volume free bytes/inodes, object growth, stale pending/failed rows,
ID-only reconciliation logs, unexpected unknown objects, audit failures and streams
with no terminal event. Define capacity/per-user quotas, global connection limits,
proxy request limits and retention before deployment. The per-file limit and upload
deadline do not substitute for capacity planning or a multi-process abuse limiter.

`bun run storage:inventory` reads known metadata/objects and reports ID-only missing,
unsafe, unfinalized, stale (>24h) pending and size findings; unknown names are counted.
Add `--verify` to stream SHA-256 checks. Supply the same server-only root/provider
configuration as the app. This guarded owner tool is **read-only**: it never promotes,
deletes or repairs files/rows and does not print storage paths or unknown filenames.

After a crash or a finding:

1. Stop writers (including workers) and preserve PostgreSQL and filesystem backups.
   Confirm the marked local database and configured private volume match; never
   perform repair using a guessed storage root or arbitrary filename.
2. Inventory first, optionally verify hashes. Treat missing available files as an
   incident; do not substitute unrelated bytes or bypass validation. Restore matching
   bytes from a verified backup or keep the document unavailable pending review.
3. For a stale pending row, verify no request/process still owns it. It is already
   unavailable for download. Trusted operator maintenance may mark that exact row
   failed in a short row-locking transaction only if still pending. Do not promote
   based only on presence of a blob: rerun validation, hashes and authorization.
4. Remove only exact generated `.part`/`.blob` names tied to a confirmed failed row,
   after writers stop and after checking the row again. Preserve failed metadata for
   investigation. Missing consent/session can block automatic failure recovery;
   owner tooling is then needed. No destructive cleanup job is supplied.
5. **Never automatically delete unknown files.** Preserve/investigate unknowns, check
   volume/database pairing, backups and interrupted restores. Keep an operator record
   of reviewed exact IDs. Do not copy confidential filenames into general logs.

Back up PostgreSQL metadata/auth/audit together with the complete private storage
volume. For a simple consistent snapshot stop application writers, gracefully drain
requests, take pg_dump using protected child environment credentials (not command-line
passwords), copy/snapshot the storage volume with modes/ownership, and record matching
backup identifiers. Encrypt backups, restrict access, test restores and define RPO/RTO
and retention. Live independent copies can miss files referenced by the DB; they are
not a consistent pair. Restore both into a fresh isolated environment, preserve the
originals, inventory/hash-verify, then resume writers. An available-row backup without
matching bytes must never be repaired by making storage public.

Linux/local filesystem semantics are required. Directory replacement by a malicious
process running as the same OS owner is outside the trust boundary; JS checks plus
O_NOFOLLOW cannot provide portable openat2 directory-fd pinning. Keep ancestors and
runtime ownership trusted. Current auth/database connectors intentionally remain
local-only; production provisioning is not implemented. Rechecks minimize but cannot
eliminate permission changes immediately after the last statement. Already-started
transfers are not forcibly recalled when consent/roles change. No long database
transaction spans downloads. Deployment needs reviewed privacy text, TLS, operational
monitoring, scanning, capacity/retention and the prior phases' release dependencies.

Future S3 migration: implement the same private provider interface, use conditional
writes and a pending/finalized lifecycle, validate/copy known objects, verify hashes
against metadata, and reconcile both backends before changing provider selection.
Keep server-side authorization and audit; do not introduce public bucket URLs. No
S3 SDK, production migration or deployment is included.

Implementation follows the existing [TanStack server route conventions](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes)
and [Node filesystem APIs](https://nodejs.org/docs/latest-v24.x/api/fs.html).
