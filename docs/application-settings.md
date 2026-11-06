# Application email settings and operations

Phase 3D uses a dedicated typed singleton in PostgreSQL, with domain, display name,
from address, optional reply-to, transactional/optional-notification switches,
version, updater ID and timestamp. Successful saves append typed configuration
snapshots and ID-only audit events in the same transaction. GET never returns a
provider credential. Tables use RLS; web runtime has no settings-table mutation grants.

The initial proposal is `Cape Clergy Vault
<notifications@notifications.ctdiocese.org.za>` on `notifications.ctdiocese.org.za`.
Resend domain verification was **reported by the user**, not independently checked.
No external domain/DNS/Resend configuration was changed. Only domains authorized by
the trusted operator procedure can be saved; sender domain must match exactly.
Additional domains require the same procedure, never a browser flag.

## Least privilege and first manager

Register, verify and independently approve the intended person's account first.
Determine the exact Better Auth identity ID through trusted operator inspection.
From an interactive local terminal:

```sh
bun run db:settings:operator grant EXACT_VERIFIED_APPROVED_ID
```

Review the displayed identity, then type `GRANT SETTINGS MANAGER EXACT_ID` exactly.
The function checks verification and approval and appends an audit event. This grants
only the separate settings capability, never reviewer/admin/approver roles or
confidential-document access. It is not called at migration/startup and never matches
an email address. No real manager fixture is installed. Additional explicit grants
use the same exact-ID procedure. Runtime cannot call the operator grant function.

To revoke, use `bun run db:settings:operator revoke EXACT_ID` and type the exact
revocation confirmation. Every subsequent request checks the live row; revocation
requires no process restart. Existing in-flight transactions/accepted provider work
cannot be recalled. Regrant is explicit and audited. No general role dashboard exists.

## Domain and exact sender authorization

Before any real send, independently inspect domain verification in the provider's
console and confirm the exact configured sender with the responsible Diocese owner.
Do not rely on `EMAIL_DOMAIN_VERIFIED` or a database flag as evidence of provider
verification. Then explicitly run:

```sh
bun run db:settings:operator authorize-domain notifications.ctdiocese.org.za
```

The tool displays the current sender (if this domain is configured) and requires
`AUTHORIZE VERIFIED DOMAIN DOMAIN SENDER EXACT_ADDRESS`. For an additional domain
that is not the current sender it requires the domain confirmation; subsequently
confirm its exact sender when saving in the protected UI. Authorization is a trusted
operator attestation, **not an automated verification claim**. No DNS API is invoked.
Direct owner maintenance can revoke `authorized_at`, with an operator audit and
backup; no browser may authorize domains. Before live use, perform a controlled
manager test and separately confirm inbox receipt.

Open `/admin/settings/email`. Saves and tests require a verified approved manager
session created within the last 15 minutes; sign out/in to renew. Invalid/future
session dates fail closed. Saving validates addresses, lengths, domain authorization
and concurrency version. A stale version returns 409 without overwriting changes.
Reload deliberately after a conflict; unsaved changes are not silently merged.
The enable control explicitly confirms the sender before live delivery.

## Delivery behavior and retries

The app's Better Auth verification/reset callbacks and the notification worker use
one shared EmailService resolver. Each send queries the non-secret PostgreSQL
configuration; no indefinite process cache or startup sender snapshot exists.
Links always use trusted `BETTER_AUTH_URL`. Domain and address validation fail closed.
Missing/invalid configuration fails the send, preserving account recovery and durable
notification retries; do not invent a sender or silently mark failed notifications
as delivered. Disabling transactional delivery blocks sends, including verification,
recovery and tests. Disabling optional notifications blocks lifecycle notification
sends while preserving their queue entries. Re-enable and recover deliberately.

Untouched setup defaults enable transactional and notification **capture** so local
registration works before a manager exists. This does not enable real delivery:
`EMAIL_PROVIDER` defaults to development capture; real sends also need a protected
API key, server opt-in and operator-authorized domain. Saved manager preferences
are never overridden by migration defaults. Production captured mode requires the
existing explicit localhost-only override. `NODE_ENV=test` cannot select a real
Resend provider even if supplied a fake/real key. Tests forbid external fetch.

Pending notifications resolve configuration at **delivery time**, not enqueue time.
Once an attempt reaches payload preparation, sender, reply-to and recipient are
persisted on that intent and reused across retries. Changed settings affect new
payloads; already-attempted intents preserve their original payload/key to avoid
Resend idempotency conflicts. Current enabled/configuration checks still run before
retry. Lease/attempt/backoff handling and templates remain intact. External I/O is
outside transactions. Provider key retention is finite; operator reconciliation
remains necessary for ambiguous/exhausted notifications. No exactly-once inbox
receipt is claimed. New domains/sender policy changes must account for outstanding
snapshots before deauthorizing an old sender/domain.

The test action accepts only `{action:"test"}`. The destination is the session's
verified address, never caller input. Persistent per-manager reservations enforce
one test per minute across workers, including failed attempts. The request is audited
before provider I/O. A local capture is labelled as captured; Resend acceptance is
reported separately from unverified recipient delivery. This is not a broadcast API.

## Credential fallback, backup and recovery

The explicitly permitted environment-secret fallback is used. `RESEND_API_KEY`
remains server-only protected configuration. There is **no encrypted credential
store, write-only key replacement action, key-version mechanism or in-app provider
switch** in this phase. Routine sender/reply-to/enable changes need no restart;
credential/provider replacement still needs protected operator configuration and
process reload. No real key was requested, embedded, printed or committed.

An encrypted vault requires separately reviewed key custody, rotation/recovery,
recent-auth credential changes, credential validation and secret-safe provider error
handling. It was deferred rather than storing plaintext in PostgreSQL. No master
encryption key is generated or stored by this phase. Even future database encryption
would not protect a fully compromised trusted application process.

Back up PostgreSQL settings, immutable history, capability rows and outbox along
with auth/metadata; use matching private filesystem backups as described in storage.md.
Back up server credentials separately with encryption and restricted operator access;
never place them in a DB dump, source archive, captured-email directory or report.
Test restoration in an isolated capture-only environment. A database backup alone
cannot restore provider credentials. Rotate a compromised API key at the provider,
replace protected server configuration, restart processes and reconcile attempted
outbox items before retry; do not copy secret values into diagnostics.

If settings are invalid, a manager can correct them through the protected UI with
an existing valid session. If authentication delivery is unavailable, use verified
existing sessions or restore a known-good settings backup via guarded operator
maintenance; preserve history and append a recovery audit. Never disable authorization
or overwrite the migration ledger. Keep an eligible manager and a tested protected
operator recovery path; provider outages must not provoke broad privilege grants.

## Phase 3E reviewer notification extension

The separate `reviewer_notifications` outbox handles invitations, assignments and
accepted/returned outcomes through the same EmailService, PostgreSQL settings and
provider-credential fallback. `bun run db:reviewer:notifications` processes a bounded
batch. No new provider or broadcast API exists. Both HTML/plain text omit private
notes, document contents and feedback. Invitation proof has a one-hour lifetime,
is AES-GCM encrypted for durable delivery, and is cleared on successful send,
consumption or cancellation. Identity-bound digest redemption requires explicit
verified approved session acceptance. Pending-envelope key rotation requires deliberate
cancellation/reissue. See [reviewer operations](reviewer-operations.md) for proof links,
leases, sender snapshots, safe retries and operational dependencies. The existing
approval outbox and its worker remain unchanged. Both workers require scheduling,
monitoring and ambiguity reconciliation before production use.

## Phase 3F operations

Both notification workers retain shared dynamic sender settings, committed stable
snapshots/keys, bounded retries and private captured mail. Assignment deliveries now
require the exact intended assignment/current revision; cancellation is audited.
Aggregate pending/stale/exhausted counts are available only through the guarded
operations CLI. No general mail dashboard or credential store is added. See
[operations](operations-monitoring.md) for scheduling, least-privilege production worker
recommendations and provider ambiguity handling. Scanner failure never changes a
review decision or notification payload.
