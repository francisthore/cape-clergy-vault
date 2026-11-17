# TEFT pilot administration and recovery

Updated for Phase 4.3.1, 17 November 2026 (Africa/Johannesburg). Synthetic local demonstration only; no real-pilot approval.

## Independent authority

The TEFT Administration page (`/admin`) combines only the capabilities returned by
live Better Auth and SQL checks. “TEFT administrator” is an operational description,
not a superuser role. No system `admin` grant is necessary for the pilot.

| Capability                                    | Ordinary web workflow                                                              | Does not authorize                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `approver`                                    | `/admin/registrations`: approve/reject/suspend/reactivate registrations            | Review, assignments or access grants                                                      |
| `review_coordinator`                          | `/admin/intake`: inspect routing records, assign/revoke exact-revision assignments | Reading resource contents, PDFs or notes                                                  |
| `reviewer`                                    | `/reviewer`: open authorized assignments; start, accept or return                  | Registration, role grants or arbitrary submissions                                        |
| `access_manager` with explicit delegated list | `/admin/access`: inspect exact identities and manage only listed capabilities      | New access managers, changing delegation ceilings, system admin or direct reviewer grants |
| `settings_manager`                            | Existing `/admin/settings/email`                                                   | Review or access grants                                                                   |

The new operational grants are separate RLS tables rather than additions to the
historical role enum. A coordinator/access manager also needs live verified,
approved clergy, an unrevoked clergy grant and current repository consent.
Revocation is checked on each operation. HTTP handlers use only the restricted
runtime connection. Do not put operator, scanner or worker credentials in web env.

Confidential intake records contain resource UUID, revision, kind, confidentiality,
submission time, workflow state and assignment evidence. Their title is replaced by
“Confidential resource”; author, category, description, filenames, documents and
review notes are omitted. Non-confidential routing additionally shows the title.
This is an explicitly authorized routing projection, not broader submission SELECT.
A coordinator who is independently an active reviewer may deliberately assign
**themselves only to someone else’s non-confidential resource**. Confidential work
requires a different authorized coordinator to assign an already eligible reviewer.
SQL prohibits author self-review and grants access only to the confirmed revision.
Coordination alone never gives document access. A single administrator cannot enable
confidential review without an appropriate second authorized person.

## One-time first administrator

No real identities were provisioned by this implementation. Supplied pilot identity
IDs are acceptance inputs, not constants in the application. An ID, email, name or
`admin` role never triggers an automatic grant. Register and verify the intended
operator identity normally, including current privacy acknowledgement, first.

Review/apply forward migrations with the existing guarded migration procedure before
using the new interface. This change adds `0037_phase422_administration.sql`; retain
all existing migration hashes and any unapplied `0036`. Do not reset the database or
rewrite a migration already applied elsewhere. The development preflight checks the
new function and fails closed on an older schema; it never migrates automatically.

From the trusted local interactive terminal, independently verify the intended
person, exact registered Better Auth ID and verified mailbox. The CLI displays the
registered name/mailbox/status for comparison against the independently trusted
record; knowing a mailbox alone is not authorization. Use an approved authorization
record and describe its reference in the operator reason without secrets.

```sh
npm run db:administration:operator -- bootstrap EXACT_ID approver,review_coordinator,access_manager approver,review_coordinator,reviewer
```

Both stdin and stdout must be TTY. The operator must enter a 20–1000 character
verification/authorization reason and then type the **exact** confirmation displayed:

```text
BOOTSTRAP EXACT_ID CAPABILITIES approver,review_coordinator,access_manager DELEGATE approver,review_coordinator,reviewer
```

Those are explicit capability selections, not defaults inferred from an ID. Add
`settings_manager` to the delegated list only when independently authorized. Use `-`
for an empty delegation list when no access-manager grant is requested. Only the
fixed guarded local owner login can execute the operator function. Runtime and
PUBLIC have no grant. The bootstrap serializes on an immutable singleton and is
refused after the first bootstrap or any previous access-manager grant. It may
approve the exact pending registered clergy identity, recording approval evidence
and a durable notification. It grants only the explicitly listed operational
capabilities. Existing approval history and the old approver-bootstrap record remain.
It never grants `reviewer`, `admin` or document access.

Operator events record actual database `session_user`, exact target, selected
capability, reason, grant reference and the selected delegation ceiling. Security
audit and any initial approval/notification commit atomically. No proof is printed.
No web bootstrap endpoint, startup hook or migration grant to a person exists.

## Two-account acceptance after bootstrap

Use synthetic identities and documents. Keep controlled capture mode explicitly
configured; do not start a worker against real recipients without separate delivery
authorization. Existing `dev:all` provider opt-ins and environment separation remain.

1. The bootstrapped TEFT person signs in and opens **TEFT Administration**. They
   approve the ordinary clergy registration under **Manage clergy registrations**.
2. Under **Manage delegated access**, inspect the TEFT person's exact ID. Confirm the
   displayed mailbox/name against trusted records. Select reviewer/invite, record
   verification evidence, and type the exact `INVITE ID reviewer` confirmation.
   Issuing the invitation does not activate reviewer privileges.
3. The existing reviewer notification worker delivers the encrypted durable intent
   through the common EmailService. In capture testing, the private capture is the
   email; do not publish it. The TEFT person signs in to that exact account, opens
   the original mailbox link and explicitly accepts responsibilities. Proof expires
   **one hour after issuance**, regardless of delivery time. It is mailbox/identity
   bound, digest-only in the invitation and AES-GCM sealed in the outbox. The web
   interface never displays or returns the proof/envelope/digest. The existing page
   removes the fragment immediately and holds proof only in memory.
4. The ordinary approved clergy person creates a non-confidential or confidential
   resource, saves meaningful details, attaches any required PDF and waits for clean
   verification, then sends it to TEFT. The author gets one acknowledgement intent
   per submitted revision; each eligible coordinator gets an intake-alert intent.
5. The TEFT person opens **TEFT submission inbox**, selects their independently
   activated reviewer identity and confirms the exact resource and revision in the
   dialog. SQL prohibits self-review, drafts, stale revisions, ineligible reviewers
   and duplicate active assignments. It commits assignment, actor evidence, audit
   and existing reviewer assignment mail together. Assignment revocation is also a
   web action with confirmation and immutable evidence.
6. The TEFT person opens **Reviewer workspace**, starts review and accepts or returns.
   Existing private streaming, clean-document/audit gates, private rationale and
   separate author feedback remain. Returned revisions require deliberate new
   assignment after amendment. Acceptance of confidential work never publishes it.
7. The author sees status/feedback and receives the existing outcome intent. The
   access manager can inspect invitation history and revoke/cancel through the UI.
   Revoking reviewer authorization also revokes assignments, cancels actionable
   mail, clears undelivered proof and removes that identity's sessions atomically.

No SQL or owner CLI is needed for ordinary invitations, registration decisions,
assignments or reviews after bootstrap. Every UI mutation has strict Origin/bounded
JSON checks, live cookie identity, SQL capability checks, transactional audit and
preserved idempotency for retries of an unchanged intent. A changed request with the
same UUID fails. Periodic/focus/visibility rechecks clear protected lists on failure.
A session/capability already in flight can finish before revocation obtains its locks;
already transferred bytes and rendered metadata cannot be recalled.

## Access-management limits

The initial delegation ceiling in the example is `approver`, `review_coordinator`
and reviewer invitation/revocation management. These are independent selections.
The UI supports exact-ID lookup, current active capabilities, live eligibility,
latest 20 invitation states, cancellation/reissue and reasoned audited grant/revoke.
An accepted historical invitation is not evidence of a currently active reviewer.
Pending duplicates are rejected; expired invitations are closed with evidence before
replacement. Restoring a changed mailbox does not revive an invalidated invitation.

Direct reviewer grants, system admin, access-manager grants and editing delegation
ceilings are unavailable through HTTP. Self-grants and self-revocations are refused;
self-invitation is also refused. Another authorized access manager must initiate the
invitation; mailbox proof and explicit recipient acceptance remain mandatory. A second
manager or guarded emergency tool handles self-revocation.
This prevents an access manager from expanding their own delegation or capabilities.

Bulk identity browsing/search, bulk grants, coordinator mail reminders, a full access
event viewer, configurable multi-party approval, remote operator identities and a UI
for appointing new access managers are deferred. Exact-ID lookup and at most 200
eligible reviewer choices are deliberate pilot limits. Access-manager appointment
and delegation-ceiling changes are exceptional operator governance, not per-resource
maintenance. Broader management should receive its own reviewed workflow.

## Break-glass recovery

Retain `db:reviewer:operator` invite/assign/cancel/revoke commands as audited emergency
tools, with their existing TTY, exact-ID and revision confirmations. They are not the
ordinary operating workflow. Preserve the auth secret separately from backups;
secret loss/rotation requires cancelling and reissuing pending encrypted invitations,
never printing/decrypting proof for an operator or resetting delivery attempts.

For a lost administrative identity, independently authorize and verify a replacement
**already verified, approved, consented clergy identity**, then recover only the
explicitly justified capabilities/delegations:

```sh
npm run db:administration:operator -- recover REPLACEMENT_EXACT_ID approver,review_coordinator,access_manager approver,review_coordinator,reviewer
```

Recovery is refused before bootstrap and requires the exact `RECOVER ...` phrase and
fresh recorded authorization reason. It does not reactivate a suspended account or
bypass reviewer activation. If no approved recovery identity is available, retain
fail-closed access and follow an independently reviewed identity/approval recovery;
do not weaken HTTP authorization or alter histories. Session/identity recovery and
host key custody remain deployment responsibilities.

To withdraw compromised administrative authority, explicitly select what to revoke:

```sh
npm run db:administration:operator -- revoke COMPROMISED_EXACT_ID approver,review_coordinator,access_manager -
```

Type the exact displayed `REVOKE ... DELEGATE ` phrase (empty delegation list) and
record incident/authorization evidence. Revocation also works for an unverified or
inactive target; it closes their sessions, retains grants/history and writes operator
evidence. It never changes business decisions. Revoke reviewer access separately
with the preserved reviewer operator command when required. Recovery does not silently
remove another person's capabilities; each revocation is a separate exact-ID action.
No emergency command is run by the web server, migrations or the dev launcher.

## Mail and diagnostics

New subjects: “Your resource has been received — Cape Clergy Vault” and
“New theological submission awaiting assignment — Cape Clergy Vault”. Messages omit
resource titles, descriptions, filenames, private notes and feedback. Author links
use their own submission view; coordinator links use `/admin/intake`. Recipients are
selected only by live eligibility and the coordinator capability, never by a named
fallback mailbox or system administrator role.

The trigger runs only for a successful draft → submitted transition. Transaction
rollback, failed/duplicate submit, reopening a page or migration creates no mail.
Each new submitted revision is a new event. No historical backfill or late fanout
runs when a coordinator is subsequently granted access. A zero-coordinator submit
still succeeds with an author intent and immutable `submission.intake_no_recipients`
audit. `db:notifications:status` reports its aggregate count/latest time and both
queues; `operations:report` counts events in the last hour. Trusted operators should
provision a coordinator deliberately and inspect the inbox; do not replay old submits.

The existing restricted reviewer worker delivers these new kinds without additional
table/owner privileges. Committed leases, SKIP LOCKED, five-minute expiry, eight
attempts, bounded backoff, stable provider keys and sender/recipient snapshots remain.
Worker eligibility rechecks coordinator/author eligibility, recipient mailbox and the
alert's current revision/status/assignment before I/O. Assignment cancels undelivered
intake alerts transactionally. Expired/revoked leases cannot finish. A send already
past its final check can still race revocation; every link checks current authority.
Provider or capture acceptance is not inbox delivery. Actual scheduling, controlled
provider/inbox acceptance and production monitoring remain release prerequisites.

## Phase 4.3.1 maintenance

Migration 0039 preserves existing grants/assignments and blocks activation of pending
self-issued invitations. Apply it only through owner-authorized forward maintenance;
see [pilot security maintenance](pilot-security-maintenance.md). Confidential PDFs
remain blocked pending an approved processing route. The current operational PDF
limit is 4 MiB within the hard 20 MiB ceiling. See the
[Diocese approval pack](diocese-pilot-approval-pack.md) before any real-clergy use.
