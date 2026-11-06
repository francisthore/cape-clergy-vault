# Private PDF quarantine and scanning

Phase 3F adds a logical quarantine inside the existing private StorageProvider. No
public bucket, alternate viewer, file copies to a scanner directory, shell command,
production daemon installation or automatic disposal is introduced. Malware scanning
reduces risk; a clean verdict is not a malware-free guarantee or PDF sanitization.

## Lifecycle and authorization

`pending` means reserved/uploading. Valid bounded header/trailer/size/hash checks now
finalize to `quarantined` and insert a durable `document_scans` intent atomically.
The response says security checks are pending. `scanning` has a five-minute lease.
Only a restricted scanner-worker function can promote to `available`, with matching
stored/scanned SHA-256 and durable clean evidence. Verified infected verdicts remain `infected` even if exclusion or author revocation happens during I/O;
errors retry in quarantine or settle in `scan_failed`. Interrupted uploads retain the
existing `failed` recovery behavior. No malware detection string reaches clients.

Existing available objects become `legacy_unscanned` through a forward migration,
with an audit for each record. They are not grandfathered into safe status or queued
silently. An operator may explicitly call `app.queue_legacy_document_scan(UUID,
'QUARANTINE UUID')` on the guarded owner connection, after reconciling the exact
object/hash and its metadata. This records evidence and queues scanning; it cannot
mark anything clean. Missing legacy objects fail closed. Do not invent scan evidence.

`app.document_is_clean` binds the job verdict to document hash and state. Document
RLS hides unsafe attachment metadata from readers/reviewers; owners can see safe
status metadata. Mandatory download authorization/start audits independently require
that predicate and the existing account/consent/parent authorization. The streaming
service repeats the clean check. Submission finalization also requires clean evidence
for every included attachment. Admin, approver, reviewer, known UUIDs and client
parameters cannot bypass this gate. Private legacy interfaces remain isolated.

`document_scan_events` is append-only; scan start/outcome/promotion and quarantine
are recorded with attempt/correlation IDs, plus security audit outcomes. Jobs record
expected/scanned hashes, attempts, engine, definition version/build timestamp,
start/completion, lease, sanitized category and correlation. No raw diagnostics,
private filenames or paths are included in events. Infected bytes are retained;
there is no quarantine download endpoint or automatic email attachment.

## Worker and trust boundaries

```sh
bun run db:migrate
bun run db:runtime:setup
bun run db:scanner:setup
bun run db:scans
```

The guarded local provisioning script creates/verifies only `cape_clergy_scanner`,
a marked LOGIN without owner membership, elevated attributes, owned relations or
schema/database creation rights. Its ignored 0600 `.env.db.scanner.local` is separate
from owner and web credentials. It can execute only claim/finalization functions,
not SELECT auth users or directly UPDATE documents/jobs. Web runtime cannot read or
mutate scan evidence, claim jobs or finalize scans. SQL checks actual `session_user`,
not an actor/GUC or a caller-provided role. A compromised trusted scanner process can
lie about its verdict; isolate its credential/process and filesystem permissions.

Claims use row locks/SKIP LOCKED, random lease tokens and committed short transactions.
A database advisory lock caps globally live leases at two; each CLI invocation scans
sequentially and processes at most 20 jobs (the reusable worker accepts 1–100).
No database transaction spans scanner/file I/O. Expired leases recover on subsequent
worker runs. Five attempts exhaust work, including a crash during the fifth lease.
Late/duplicate results cannot promote; the current unexpired lease must match.
Unknown commits leave durable state for recovery. Retry delays start at 60 seconds
and double to a bounded hour. Integrity mismatch, missing bytes and size limits are
terminal. Exhausted work requires operator investigation; no reset loop exists.

The worker hashes the exact streamed bytes, enforces recorded size and the 20 MiB
ceiling, and reopens/re-hashes a clean object's current key before promotion. It
rechecks parent type, exclusion and live author eligibility after scanning. No file
replacement is supported by application writes. A privileged OS process could replace
bytes after the last hash check; protect filesystem ownership and ancestors. This is
not protection against a compromised OS/storage owner. Already transferred bytes
cannot be recalled by later revocation.

## ClamAV integration and operational prerequisites

Only `CAPE_SCANNER=clamav` is configurable. Tests inject `TestScanner` explicitly;
it cannot be selected by environment and refuses production. The production adapter
uses an absolute server-configured Unix socket, never a user path or TCP endpoint.
World-accessible or symlink socket files are rejected. Provision a protected socket/parent with access limited to worker/readiness identities.
Run clamd with `TZ=UTC` because VERSION's build time is timezone-less. Invalid or
missing engine/database build information fails closed.

Readiness checks PING, advertised INSTREAM support, parsed engine/database version
and build age, and a valid harmless streamed PDF. Definition age defaults to 48 hours;
`CAPE_SCAN_MAX_DEFINITION_AGE_HOURS` accepts 1–72 hours. SQL independently refuses clean
promotion beyond 72 hours or with future build timestamps. Definitions must remain
fresh; never relax thresholds automatically. VERSION is checked before and after
scanning; a database/engine change during a scan forces retry.

INSTREAM uses NUL command framing, four-byte big-endian chunk lengths, at most 64 KiB
chunks and a zero terminator. Replies must be complete, single, bounded NUL records.
Unknown, incomplete, limit and ERROR responses cannot become clean. Connection,
exchange and whole-scan deadlines are respectively 2 seconds, 30 seconds and 120
seconds by default; worker operations have a 180-second bound, below the lease.

Before release, independently review/install supported ClamAV/clamd/FreshClam, use
`StreamMaxLength` above 20 MiB (e.g. 25M), and align MaxFileSize/MaxScanSize/recursion
limits with PDFs and decompression capacity. Enable supported alerts for scan-limit
exhaustion and encrypted/uninspectable PDFs (including AlertExceedsMax and applicable
AlertEncrypted controls); silent daemon-side skips must never be treated as sufficient
inspection. Validate exact daemon configuration using permitted PDFs, safe scanner
test signatures and limit fixtures. Configuration attestation is an operator launch
prerequisite, not something the protocol can fully discover.

FreshClam must update authentic supported signature databases and trigger daemon reload.
Monitor loaded VERSION age, updater failures and health-test outcomes; updater mtime
alone is insufficient. During outage preserve quarantine and durable retries. Restore
socket/daemon/definitions, run health and a safe positive/negative integration check,
then resume the worker deliberately. Do not delete infected/exhausted objects without
an approved retention/investigation policy and future explicit disposal workflow.

Protocol reference: [official clamd protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html).
See the Phase 3F report for actual test results and the explicit real-daemon skip.
