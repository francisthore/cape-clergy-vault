# Phase 4.1B — Bouncer scanning operations

Repository integration only, assessed 16 November 2026 (Africa/Johannesburg).
No deployment, paid plan, service installation or live scan was performed. Michael's
original attribution and isolated historical interfaces are preserved.

## Contract and external processing

The [official API reference](https://usebouncer.dev/docs/) was checked during this
implementation. Calls use the fixed HTTPS origin `api.usebouncer.dev`, server-side
`X-API-Key`, bounded JSON, sanitized categories and no redirects. Files up to 4 MiB
use multipart `POST /v1/scan` (a conservative threshold below its approximate request
cap). Larger PDFs through exactly 20 MiB use `POST /v2/scan`, then stream multipart
fields and the file last to the returned S3 target. The scan ID commits before S3
I/O. Both paths poll `GET /v1/scan/{scan_id}`; the reference says v1/v2 reads are
interchangeable. Temporary upload fields exist only in process memory, never logs,
configuration, database or browser responses. We send the neutral name `document.pdf`,
not the clergy filename, identity, title or private storage key. Document contents,
size and hash necessarily leave the Diocese's storage.

The [provider privacy policy](https://usebouncer.dev/privacy/) states AWS Mumbai
(`ap-south-1`) processing, deletion of uploaded content within 24 hours and persistent
scan metadata for the account lifetime. These are provider statements, not independently
verified deletion, contractual guarantees or Diocese approval. Before any real clergy
transfer, the Diocese Information Officer and responsible offices must approve the
processing purpose/lawful basis, appropriate notice and consent arrangements, cross-border
transfer, confidentiality classification, processor contract/subprocessors, retention,
rights handling, incident response and accountable operators. A successful API test
cannot establish POPIA compliance. Confidential material remains **not approved** for
this external transfer. No new per-upload consent screen pretends to supply that approval.
The [privacy readiness register](privacy-retention-readiness.md) remains applicable.

## Protected worker configuration

Keep these in the existing ignored, protected `0600` scanner environment
`.env.db.scanner.local`, alongside its restricted database URL, never in `VITE_*`,
ordinary application settings or the web process:

```dotenv
CAPE_SCANNER=bouncer
BOUNCER_API_KEY=REPLACE_PRIVATELY
BOUNCER_UPLOAD_HOST=EXACT_APPROVED_BOUNCER_S3_BUCKET_HOSTNAME
```

The hostname must match the exact approved returned bucket, with a `bouncer-` prefix
and `.s3.amazonaws.com` or `.s3.ap-south-1.amazonaws.com` suffix. The documented URL
contains a placeholder, so this repository intentionally supplies no invented real
bucket. Verify and pin the real hostname independently before authorized large-file
acceptance. The upload path must be `/`, without credentials, query, fragment or port;
the object key must bind the persisted scan ID to `uploads/{scan_id}/document.pdf`.
Private IPs, arbitrary domains, alternate regions, redirects and unsafe form fields
fail closed. DNS/TLS trust and protection of the operator's hostname configuration
remain infrastructure prerequisites. Egress controls should permit only the API and
the reviewed AWS bucket. A missing pin prevents large-file quota reservation/upload.

`CAPE_SCANNER=clamav` retains the existing protected Unix-socket adapter. The default
remains ClamAV; unknown configuration is rejected. No environment-selectable test
provider exists; the explicit TestScanner refuses production. Provider switching does
not reset an existing Bouncer job or let ClamAV claim its evidence. It does not silently
upload a partially attempted ClamAV job through another provider.

Use the existing local-only guarded commands after reviewing the migrations:

```sh
npm run db:migrate
npm run db:scanner:setup
npm run db:scans
npm run db:scans:usage
```

Scanner setup verifies only the existing project role and grants; it does not grant
reviewer/user capabilities or copy the API key. `db:scans:usage` performs only a bounded
usage GET and emits aggregate period/count/reset information. It never submits a file.
Do not execute these commands against another application/database or turn them into
a deployment recipe. Worker sources and dependencies must accompany the artifact.

## Durable state, leases and crash recovery

`document_scans` records provider, external ID, expected SHA-256/size, submission
revision, submitted/last-poll times, provider status, sanitized result category,
provider hash/size, poll and failure counts, correlation ID and existing retry/lease
state. Existing ClamAV engine/definition evidence is retained unchanged. Bouncer
never fabricates those fields. Migrations are additive; scan events and audits remain
append-only and worker functions check the actual restricted `session_user`.

A claim commits a five-minute random lease. No transaction spans provider or file I/O.
Before submission, local bytes are hashed, free usage is checked and a database quota
reservation plus `submitting` marker commits. A returned ID is durably accepted before
further work. Missing acceptance after a committed marker is **ambiguous**, even if a
crash could have occurred before the HTTP request. Recovery holds that job terminally
for investigation; it never guesses that re-upload is safe. Bouncer documents no
idempotency key, so automatic exactly-once provider submission cannot be promised.

An existing ID always resumes polling; it never requests another target or re-uploads.
For v2, a crash after ID persistence but before S3 completion may leave a scan pending.
The worker polls that same ID to its bounded limit rather than persisting/replaying
upload credentials or consuming another scan. Targets expire after 15 minutes and an
unuploaded scan can later disappear at the provider. A 404 or missing result cannot
create clean evidence. Unknown acceptance/database commits preserve the marker/lease;
late and duplicate finalization are fenced. Do not reset jobs or budget counters to
work around exhaustion. Reconcile IDs/times with private provider history and append
operator evidence; any future requeue function requires separate review.

Only one external scan is in flight globally, including between poll leases. CLI
batches process at most 20 sequential jobs (reusable bound 1–100). Polls are no more
frequent than 30 seconds, and a restarted worker may run less often under the existing
60–65 second loop. A maximum of 120 poll claims/two hours bounds pending work; failed
provider reads back off exponentially from 60 seconds to an hour, with five failures.
Crashed leases count toward the relevant bounds. Invalid/failed/suspicious/integrity,
missing-object and unsafe-destination results require investigation; none authorize
bytes. Bouncer outages leave ordinary DB/storage-backed application service usable.
Web readiness can be degraded; the web does not need the Bouncer secret.

## Free allowance and monitoring

The reference currently describes an account-wide free allowance of 500 monthly
scans. A v2 target consumes allowance even without a completed upload. The adapter
requires the `free` tier, current UTC month/reset and a limit no greater than 500.
There is no plan-change, billing or paid fallback operation. A locked private
`scanner_budget` row reserves each possible submission conservatively against the
higher of provider-observed usage and local reservations. Ambiguous/failed reservations
are not refunded. This can leave unused allowance; preserving quota is preferred.

Quota exhaustion blocks fresh claims until the next UTC month and keeps affected
files quarantined. Accepted scans retain their IDs and are never resubmitted. Usage
is rechecked before every new submission. Use a dedicated free account for this app;
other consumers can use allowance between our check and POST. The provider's account
limit is still the authoritative final protection; our database cannot atomically
reserve quota across unrelated external callers. Do not upgrade the account while
this free-only integration is in use.

Monitor usage/remaining allowance (suggested alert at 400/450/500), oldest pending
job, active leases, poll/failure counts, ambiguous/held categories and worker heartbeat.
The private owner operations report can inspect the durable budget and scan rows;
no new public diagnostic or quarantine-download endpoint exists. The usage CLI
supplies provider counts independently. Alert collection, schedules, recipients and
host acceptance remain deployment prerequisites, not installed infrastructure.

## Promotion and downloads

Only a completed clean response for the stored ID with exact expected SHA-256 and
size is eligible. The worker reopens/hashes bounded local bytes immediately before
finalization. SQL independently checks matching evidence, lease, document state,
current revision, exclusion and live author verification/approval/clergy/consent.
Malicious evidence remains infected even if eligibility is revoked during I/O.
Suspicious results are unavailable for investigation. No absent/unknown field or
verdict is interpreted as clean. The scanner is trusted to report honestly; isolate
its credential and process. Malware detection is not PDF sanitization or a guarantee
against every malicious file. Trusted OS tampering after the final hash remains
outside this database boundary.

The existing clean predicate, RLS, submission gate and committed download authorization
and start audits still apply. No web role can claim, accept, reserve or finalize scan
evidence; no direct worker table writes are granted. Existing clean objects remain
readable during provider outages subject to current authorization. Revocation cannot
recall bytes already transferred.

## Browser and proxy limits

The shared browser-safe limit is exactly **20,971,520 bytes**. File input and drop
selection immediately reject oversized/empty/non-PDF selections, announce inline
errors, allow replacement and disable upload until valid. A synchronous XHR reference
prevents double-click submissions. Selection itself performs no upload/reservation.

The server independently enforces actual streamed bytes, private filesystem integrity,
PDF header/trailer, MIME/name and authorization; browser checks are only early feedback.
The existing Nginx example allows `21m`, leaving headroom while the application applies
the exact 20 MiB boundary. Nothing was installed or changed on a reverse proxy. A
smaller deployment limit could reject an otherwise valid file and must be coordinated.

## Integration-test isolation and retained evidence

`npm run db:test:phase41b` creates a fresh verified disposable PostgreSQL environment;
it does not read the private local database env files. Keep the preserved project
cluster stopped before this command. The runner refuses an active project cluster
and never stops/reset an existing server to make room. It replays current migrations
and restricted grants, verifies its protected per-run identity, and disposes only
its whole fresh cluster after stopping/verifying it. Individual history rows and
triggers are not removed or bypassed for cleanup. The raw test file refuses execution
without that isolated provenance.

`db:audit:phase3e` and `db:audit:phase3f` remain read-only against their existing guarded
local target. They require no live fixture residue and verify append-only enforcement
and restricted privileges; they report retained evidence instead of demanding an
empty history. Three earlier synthetic download-audit rows are intentionally retained.
See the [implementation report](phase-41b-report.md) for causes and preservation checks.

## Phase 4.3.1 superseding operational safeguards

The UI/server operational limit now defaults to **4 MiB**, with a fixed 20 MiB hard
ceiling. Confidential PDF uploads are refused before storage reservation. The database
0038 gate blocks new confidential claims/reservations, and forward migration 0039
fences later classification changes after any committed external-transfer intent,
including excluded attachments and stale repeatable-read transactions. Provider IDs
continue reconciliation without new bytes; missing-ID submission markers remain
ambiguous. No real scanner was invoked during remediation.

The official [v2 reference](https://usebouncer.dev/docs/) was re-read on 17 November
2026; it still supplies a placeholder bucket. No actual host or live v2 integration
was verified. Do not raise `CAPE_SCREENING_MAX_BYTES` until the worker pin/contract and
authorization have evidence. Protected current held-job counts are zero; the read-only
inventory found two currently confidential PDFs with provider IDs requiring responsible-
party investigation. That is potential historical transfer evidence, not a real-data
or legal determination. Never infer that a gate recalls prior bytes.

Read [pilot maintenance](pilot-security-maintenance.md) for the owner migration and
held-job procedure and [preflight](phase-5-deployment-preflight.md) before deployment.
No automatic requeue, quota reset or large-file fallback was added. Separate-endpoint
`test:phase43`/`test:phase422` now run alongside the preserved cluster; the direct
original-endpoint `db:test:phase41b` still refuses an active preserved database.

Historical confidential Bouncer clean verdicts remain stored provider evidence but
0039 excludes them from `document_is_clean`; submission and audited download gates
cannot release those bytes without a separately reviewed approved route.
