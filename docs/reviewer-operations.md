# Reviewer authorization and operations (Phase 3E)

This runbook supersedes historical broad reviewer/admin access in earlier reports.
Use only the existing guarded local database. No real reviewer is provisioned by
migration, startup, email matching or clergy approval. Michael's original Lovable
concept/development attribution remains in README.

## Capabilities and confidentiality

| Capability                                                       | What it authorizes                                                                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Approved clergy, verified session and current repository consent | Own submissions; accepted non-confidential repository content                                                                                   |
| Clergy approver                                                  | Registration decisions through the existing approval service                                                                                    |
| Settings manager                                                 | Authorized application email settings                                                                                                           |
| Theological reviewer                                             | Current assignments, provided clergy/reviewer grants, verification, approval and consent remain live                                            |
| System admin                                                     | Existing explicit profile/role/audit administration reads; **no** implicit reviewer, assignment, private-note or confidential-submission access |
| Trusted local operator                                           | Exact-ID invitation, assignment and revocation commands using the guarded owner connection; never a web handler                                 |

Independent legitimate capabilities may coexist on an account. Each action checks its
own required capability. `app.is_reviewer()` now requires explicit clergy and reviewer
grants, verified identity, approval and current repository consent. It no longer treats
admin as reviewer. `app.can_review_submission(id)` additionally requires a non-author,
active assignment to the exact current revision, with status submitted, under_review,
accepted or returned. RLS uses that helper for submissions, current-revision private
review decisions and assignments. Document SELECT inherits parent RLS; its mandatory
pre-transfer audit function independently repeats the same authorization predicate.

Completed resources remain in a reviewer's workspace while their assignment remains
active for that same revision. Starting an amendment removes reviewer access until a
new assignment is deliberately made. Historical notes for older revisions remain
immutable and operator-retained; current reviewer UI does not expose them. Authors
retain intended revision feedback. Accepted non-confidential repository access remains
ordinary clergy access even if a former reviewer assignment is revoked. Confidential
accepted resources stay outside repository searches, counts, metadata and downloads.

## Invitation issuance and mailbox proof

First independently confirm the intended person, their exact registered Better Auth
identity ID, verified mailbox, approved profile and active clergy role. From a trusted
interactive terminal (stdin **and** stdout must be TTY):

```sh
bun run db:reviewer:operator invite EXACT_ID
```

Inspect the displayed identity, verified state, approval and roles. Type
`INVITE EXACT_ID` exactly. This does not approve a pending account. It queues an
invitation and prints its reference UUID, never its proof. A second pending invitation
is refused. Expired invitations are closed with evidence when replacing them. No
hardcoded email, public issuance endpoint or broad role-management dashboard exists.

Proof is 32 cryptographically random bytes, base64url encoded. The invitation stores
only SHA-256. A separate durable outbox holds AES-256-GCM ciphertext, using a random
96-bit nonce, identity-bound AAD and a purpose-separated HKDF key derived from the
protected `BETTER_AUTH_SECRET`. No plaintext token is stored in database rows, logs,
operator output, bundles or administrative lists. This protects a DB-only disclosure;
a compromised trusted server with the protected secret remains outside the boundary.

The one-hour expiry starts **at issuance**, not email delivery. The invitation is bound
to the exact identity and verified mailbox. Changing email or email-verification state
permanently revokes pending invitations, even if the original email is restored. The
worker cancels expired, revoked, consumed or mailbox-mismatched intents. Approval,
clergy role, verified session and current consent are rechecked at explicit acceptance.
Expiration, revocation and another identity cannot redeem the proof. Concurrent
acceptance has one winner and cannot duplicate grants. No approver/settings/admin grant
is made. Role activation, consumption, immutable reviewer event and security audit are
one transaction. A failed transaction grants nothing.

Run the existing capture-safe worker extension separately:

```sh
bun run db:reviewer:notifications
```

Links use only trusted `BETTER_AUTH_URL`, with proof in a fragment:
`/reviewer/invitation#token=...`. Fragments are not HTTP request targets or referrers.
The page removes the fragment with replaceState immediately and retains proof only
in component memory. There is no credential in page metadata, SSR, analytics, browser
storage or GET APIs. POSTs require exact Origin, strict bounded JSON and authentication.
The recipient must sign in first, then reopen the original email link if necessary;
refreshing/navigation deliberately loses the in-memory proof. Inspection alone grants
nothing. The recipient explicitly acknowledges responsibilities before accepting.
Same-identity inspection explains consumed/expired/revoked state. Other-account and
unknown links receive generic unavailable responses without disclosing an identity.

To withdraw a still-pending invitation:

```sh
bun run db:reviewer:operator cancel-invitation EXACT_ID INVITATION_UUID
```

Type `CANCEL-INVITATION EXACT_ID INVITATION_UUID`. Cancellation preserves history and
clears undelivered ciphertext. Delivery success and acceptance also clear ciphertext.
Captured email files remain sensitive credentials until expiry; keep the existing
0700/0600 capture controls. No public capture viewer or live Resend test is supplied.

Key recovery: preserve the protected auth secret separately from database/storage
backups. Rotation/loss prevents decryption of still-pending envelopes. Cancel and issue
fresh invitations under the new secret; do not reset attempts, print/decrypt old proofs
for an operator, or store a plaintext recovery token. Existing verified/accepted
invitations do not require retaining delivery ciphertext. Lost invite mail needs
explicit cancellation/reissue; duplicate active invitations are never silently replaced.

## Assigning and revoking a revision

```sh
bun run db:reviewer:operator assign EXACT_REVIEWER_ID SUBMISSION_UUID
```

The terminal displays the exact reviewer and submission state/revision. Confirm
`ASSIGN EXACT_REVIEWER_ID SUBMISSION_UUID REVISION N`. SQL locks/rechecks that inspected
revision. If it changed while confirmation was pending, the assignment fails; inspect
again deliberately. Only submitted/under-review items can receive new assignments.
Active verified approved clergy/reviewer status and current consent are required.
Author assignments, drafts, completed items and duplicate active assignments fail.
Multiple different reviewers may be assigned; conflicting decisions have one winner.
The immutable assignment event, ID-only audit and assignment email intent commit with
the assignment. There is no runtime INSERT/UPDATE or self-assignment endpoint.

```sh
bun run db:reviewer:operator revoke-assignment EXACT_REVIEWER_ID ASSIGNMENT_UUID
bun run db:reviewer:operator revoke-reviewer EXACT_REVIEWER_ID
```

Confirm `REVOKE-ASSIGNMENT EXACT_REVIEWER_ID ASSIGNMENT_UUID` or
`REVOKE-REVIEWER EXACT_REVIEWER_ID`. Role revocation revokes active assignments, closes
pending invitations, cancels queued reviewer invitation/assignment notices and deletes
all current Better Auth sessions transactionally. It never deletes immutable decisions
or grants other capabilities. Assignment revocation removes the relevant access on
subsequent requests without removing unrelated valid assignments. Reinstatement needs
a fresh mailbox invitation and explicit new assignments, never an email comparison.

Operator evidence records actual database `session_user`, target, event/correlation
and affected reference IDs. It does not invent a clergy actor for a terminal operator.
The local owner is trusted; separate named production operator identities and host
operator auditing remain deployment work. Owner-only internal functions are not granted
to runtime or PUBLIC. A future coordinator should receive a dedicated explicit
assignment-management capability and narrowly scoped transactional functions/dashboard;
admin/approver/settings roles should never substitute for it or receive confidential
resource data merely to arrange assignments.

## Review, feedback and concurrency

`/reviewer` searches only currently authorized assignments, with status filters and
20-row server pagination/counts. `/reviewer/submissions/{id}` rechecks before protected
HTML rendering and through authenticated APIs while open. Details expose necessary
author name/title/parish, current metadata, authorized attachments and current-revision
review history. All PDF links use the Phase 3C audited private streaming endpoint.

| Transition   | Required starting state | Required commentary                                                                           |
| ------------ | ----------------------- | --------------------------------------------------------------------------------------------- |
| Start review | submitted               | Optional author feedback/private notes                                                        |
| Accept       | under_review            | Private rationale of at least 20 normalized characters; author feedback optional              |
| Return       | under_review            | Author-facing amendment guidance of at least 20 normalized characters; private notes optional |

Each text field is capped at 10,000 characters. Notes are saved with an immutable
action; no separate mutable notepad is introduced. Acceptance/return have accessible
confirmation dialogs. Conflict disables further actions until an explicit refresh.
The client preserves a request UUID for retries of an unchanged intent. SQL validates
replayed identity, submission, assignment, version, action and exact commentary.
Changed intent with the same key fails. A replay of an older request after access is
revoked or the revision changes also fails authorization. No automatic content decision
or reviewer metadata/confidentiality/ownership editing exists.

`app.decide_review` locks live identity/profile/roles, parent and assignment, then
checks state/version. It updates status/version, inserts an immutable typed decision,
appends an author-visible lifecycle snapshot, writes an ID-only security audit and
creates any final-decision notification in the same transaction. Failed insertion
anywhere rolls back everything. Provider I/O happens after commit, never in SQL.
Legacy `review_decisions.notes` stays private and immutable; new fields carry explicit
author feedback and revision. Historical rows keep NULL revision instead of invented
revision claims. `app.author_review_feedback` selects only ID/outcome/feedback/revision/
time for the owner. It never selects notes, reviewer identity or assignment evidence.
Returned → amendment draft retains every earlier feedback item and decision and
increments revision; no prior note is overwritten.

Short requests use live Better Auth cookies and database checks, not client role
snapshots. Revocation can wait behind an already-running transaction's row locks;
previously rendered metadata and already-transferred PDF bytes cannot be recalled.
No per-chunk locks or instant global cancellation are claimed. Downloads still require
committed authorization/start audits before bytes and retain the Phase 3C terminal-
audit limitations. No public object URL or anonymous access is introduced.

## Notification operations

Four domain intents: reviewer invitation, assignment, submission accepted and returned.
They use the shared EmailService, dynamic PostgreSQL sender/enable settings, Resend
credential fallback, HTML/plain text and trusted-origin links. Messages omit resource
contents/titles, private notes and feedback; authors sign in to read feedback. There is
no broadcast list or competing email provider. Invitation delivery is gated by both
transactional and lifecycle-notification switches, consistent with current settings.

The separate outbox uses stable `reviewer:UUID` provider keys, five-minute committed
leases, SKIP LOCKED claims, first-attempt sender/reply-to/recipient snapshots, safe
error categories, exponential retry delay capped at an hour and eight total attempts.
Expired leases recover crashed work. Delivery never changes a committed review.
Current sender enable/validity checks still apply to retries. Expired invitation proof
is cancelled rather than repeatedly sent. Schedule/monitor this worker before real
use; this phase installs no daemon. Inspect counts/attempts/cancellation/delivery state
using guarded operator tooling, never expose encrypted envelopes in diagnostics.
Do not automatically reset exhausted or ambiguous attempts: reconcile provider evidence
first. Provider idempotency retention is finite; exactly-once inbox delivery is not
claimed. An in-flight send can complete after a revocation; its link still checks live
authorization. Local tests capture mail and prohibit external network fetch.
