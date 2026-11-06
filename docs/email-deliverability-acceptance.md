# Transactional email acceptance

Live deliverability: **Not tested / blocked on exact recipient and sending-operation
authorization**. No real Resend request, DNS change or account-setting change occurred.
The owner reports `notifications.ctdiocese.org.za` verified; that is reported evidence,
not independent provider/DNS validation. Proposed sender:
`Cape Clergy Vault <notifications@notifications.ctdiocese.org.za>`.

Settings remain typed PostgreSQL sender/domain/display/reply-to/enabled rows with
immutable settings history and protected operator domain authorization. Resend key
and provider selection remain protected server configuration. Sender edits resolve
without restart; API-key/provider changes require controlled process reload. No
credential vault was added. Trusted BETTER_AUTH_URL determines links independently
of sender domain. Both transactional and lifecycle switches gate outbox sends.
No live flag was automatically enabled. Local capture tests temporarily set synthetic
settings/authorization and restore them; no DNS/provider state is changed.

## Exact authorization record before any live send

Owner must supply the exact recipient mailboxes, each permitted message type/count,
sending identity/domain, time window and operation, plus consent to provider I/O.
Use disposable controlled mailboxes, never real clergy as fixtures. Record the
operator, authorization reference and trusted staging origin; no invented approver.
Read existing settings and provider/domain evidence without printing the key.
Verify reply-to and both enabled flags. Confirm SPF/DKIM/DMARC and provider domain
status through separately permitted evidence. Do not change DNS as part of a send.
If not authorized, stop at this procedure and continue capture-only tests.

## Execute each approved message separately

| Message             | Controlled action                           | Required business/link evidence                                              |
| ------------------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| Verification        | disposable registration/resend              | verification only, still pending clergy approval                             |
| Password recovery   | reset request                               | generic public response; expiry/single use/session revocation                |
| Approval            | authorized approver decision                | decision/history committed independently of delivery                         |
| Reviewer invitation | exact-ID trusted operator invitation        | one-hour encrypted proof, correct mailbox, explicit authenticated acceptance |
| Review assignment   | exact reviewer/revision operator assignment | active exact assignment, live authorization on link                          |
| Returned submission | assigned reviewer return                    | author reads safe feedback after sign-in; no private notes in mail           |
| Accepted submission | assigned reviewer acceptance                | author link authorized; confidential content stays private                   |

For each, record intent/correlation ID (or auth test reference), timestamp, kind,
provider idempotency key/reference, sanitized result category and separately permitted
receipt evidence. Never record proof/token, body/private feedback, key or session.
Check both text/HTML, sender/reply-to, intended origin and mailbox receipt/spam placement.
Do not click a different account's link to infer privilege or bypass verification.

| State              | Meaning and recovery                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Queued             | durable intent committed; no provider acceptance claimed                                                                  |
| Provider accepted  | provider accepted a submission; `delivered_at` is a legacy column name for worker acceptance, not proof of inbox delivery |
| Provider rejected  | safe failure category; retain snapshot/key and bounded retry rules                                                        |
| Delivery confirmed | independently permitted provider delivery evidence and/or recipient receipt reference; record source                      |
| Expired/cancelled  | no new actionable delivery; invitation/assignment links continue checking live authorization                              |
| Ambiguous          | crash/timeout around provider acceptance; reconcile provider evidence before intervention                                 |
| Exhausted          | eight attempts; investigate; no automatic reset/rebuild                                                                   |

No delivery-event webhook or inbox-confirmation database model is introduced. Provider
receipt IDs are not currently durably retained by EmailProvider; operators must keep
permitted evidence externally. That limits automated reconciliation and must be
reviewed before live acceptance. Stable provider keys/payload snapshots remain usable
for lookup; finite provider idempotency retention is not exactly-once delivery.

## Capture-only recovery evidence and executable cases

Run `db:test:phase3a`, `db:test:phase3b`, `db:test:phase3d`, `db:test:phase3e`,
`db:test:phase3f:notifications`, `db:test:phase4` and `test:browser`. These cover
verification/reset, disabled delivery, simulated rejection/outage, sender changes,
expired/cancelled invitations, worker lease recovery, duplicate stable request keys,
retry/exhaustion and changed mailbox. Provider mocks/captures never contact Resend.
Missing API key preflight fails. An actual invalid Resend key/rejection is **Not tested**;
use a synthetic rejecting provider for local recovery, not an unauthorized live call.

If worker stopped, resume one loop and recover expired leases. If email disabled or
sender invalid, fix authorized settings, retain attempts and snapshots; never waive
account verification. Snapshot sender changes do not rewrite an attempted message.
Changed actionable mailbox cancels; operator deliberately reissues only after exact
identity checks. Missing invitation key requires cancellation/reissue, never plaintext
proof recovery. Outages do not change committed approval/review decisions.
See [roles](production-database-roles.md) and [reviewer operations](reviewer-operations.md).
