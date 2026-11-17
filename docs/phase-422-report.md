# Phase 4.2.2 — Submission readiness and TEFT administration

> Historical Phase 4.2.2 evidence. Self-invitation and confidential self-assignment
> described here are superseded by Phase 4.3.1; see [current remediation](phase-431-pilot-remediation-report.md).

17 November 2026 (Africa/Johannesburg).

Implemented locally. No deployment, commit, push, persistent database migration/reset,
real capability grant, real mailbox inspection, live email or external PDF transfer
was performed. The two supplied local identity IDs are not hardcoded or provisioned.
Tests use unrelated synthetic exact identities in whole disposable environments.

## Root causes and scope

The homepage had unconditional registration/sign-in CTAs despite the existing trusted
account provider already driving navigation. It now uses that same context and
conceals actions while checking or when the check fails. Guests see registration and
sign-in; pending/incomplete clergy see registration status; repository-eligible clergy
see create/browse/my-submission actions. Reviewer, approver, coordinator, settings and
access-management actions each require their own server-derived capability.

The readiness expression already depended on persisted title, normalized description
and editing state; it did **not** depend on confidentiality. No deterministic
checkbox-to-readiness coupling was reproduced, so this report does not attribute a
business-rule failure to that checkbox. A concrete state-consistency defect was
identified: successful POST closed the editor before the GET of the saved revision
finished. That could show the old persisted checklist while the new save was loading.
The editor and disabled submission state now remain until the successful persisted
refresh completes. On refresh failure the UI reports that the save committed but
requires a refresh before continuing; it does not declare stale data ready. New and
existing resources, checked/unchecked confidentiality, save/reopen and the existing
20 normalized character description rule are covered. No scanner/PDF or final-submit
eligibility rule was relaxed.

Registration decisions, reviewer activation, review actions, final notifications and
private streaming already existed. Missing coordinator authority, safe intake
projections, assignment functions and delegated access management were the actual
barriers to normal TEFT UI operations. The extension supplies those boundaries and
a capability-combined dashboard rather than treating `admin` as a substitute.

## Implementation

- `/admin`: TEFT Administration dashboard; `/admin/intake`: paginated intake and
  unassigned count, eligible reviewers, explicit exact-revision assignment/revocation
  and actor/status evidence; `/admin/access`: exact-ID inspection, delegated
  capability grant/revoke and reviewer invitation/cancellation/revocation management.
- Existing `/admin/registrations`, `/reviewer` and `/admin/settings/email` remain
  separate capabilities. No system admin or implicit reviewer grant is introduced.
- New RLS-protected `operational_grants` stores coordinator/access-manager grants;
  each manager has an explicit ceiling of delegatable capabilities. The UI cannot
  appoint access managers, expand ceilings, grant system admin or directly activate
  reviewers. Self-grants/revocations are refused; self-invitation still requires proof.
- New SECURITY DEFINER functions have fixed `pg_catalog` search paths, explicit
  runtime execution grants and no PUBLIC execution. Sensitive operational/history/
  bootstrap tables have no runtime access. HTTP uses the existing verified live
  Better Auth cookie boundary, strict Origin, bounded JSON and shared rate limiting;
  no browser actor or role is trusted. No owner connection is imported by web handlers.
- Confidential intake withholds titles, author information, category, descriptions,
  filenames, PDFs and private notes. It returns only deliberately authorized routing
  evidence. Submission/document/review RLS and private streaming are unchanged.
- A separately activated coordinator/reviewer may deliberately assign themselves to
  **another person's** submission, as requested by the owner. SQL rejects author
  self-review, stale revisions, drafts, ineligible reviewers and duplicate active
  assignments. This narrowly supersedes the earlier blanket no-self-assignment rule.
- Reviewer UI issuance uses the existing cryptographic proof envelope/digest and
  durable restricted worker. A one-hour issuance expiry, exact identity/mailbox
  binding and explicit authenticated acceptance remain required. Lists/API responses
  contain no token, digest, envelope or invitation link. Email changes permanently
  invalidate pending invitations. Revocation preserves history, revokes assignments,
  cancels undelivered actionable messages and deletes target sessions.
- Author detail receives only fixed `assigned`/`unassigned` state for the current
  revision, using live reviewer eligibility, never reviewer identities/notes. The
  confirmation is: “Your resource has been sent to TEFT. It is awaiting assignment
  for theological review.” Starting and completing review keep existing status and
  safe author-feedback boundaries.
- `0037_phase422_administration.sql` is a new forward migration, schema snapshot and
  journal entry. Existing migration SQL files/histories are untouched. Reviewed grants
  are in both that migration and runtime setup. The dev preflight requires the new
  function and fails closed against an unmigrated database; it never repairs it.

## Transactional receipt notifications

A successful draft → submitted status trigger queues one author acknowledgement per
submitted revision and one alert per currently eligible coordinator. Business state,
intents and ID-only audit commit together. Failed/duplicate/rolled-back transitions
queue nothing. There is no historical backfill, late fanout or named fallback mailbox.
Zero-coordinator submission still succeeds, queues the author intent and records
`submission.intake_no_recipients`; aggregate diagnostics expose this to trusted
operators in `db:notifications:status` and `operations:report`.

Both new kinds use the existing reviewer outbox and restricted worker, common
EmailService, dynamic PostgreSQL settings, stable provider keys, payload snapshots,
five-minute leases, eight attempts and bounded backoff. Messages omit submission
contents/title/description/filenames/private feedback and link to authorized views.
The worker rechecks live recipient/mailbox and coordinator authority, exact revision
and current assignment before I/O. Assignment cancels pending intake alerts. Author
acknowledgement remains a receipt even when review advances. Provider/capture
acceptance is explicitly distinguished from inbox delivery. The documented final
check/provider race and inability to recall already delivered mail/bytes remain.

## Bootstrap, emergency recovery and ordinary operation

[TEFT administration and recovery](teft-administration.md) documents the exact
one-time interactive operator command, independent identity verification, explicit
capability/delegation choices, typed confirmation, immutable actual database-operator
evidence and guarded recovery/revocation. Bootstrap may explicitly approve that exact
pending registered identity, but cannot grant reviewer/system admin status or PDF
access. No bootstrap invocation occurs in a migration/startup/HTTP handler. The
supplied local fixtures were not inspected or granted privileges.

After deliberate bootstrap, the two-account pilot needs no SQL/owner CLI for normal
registration approval, reviewer invitation/acceptance, assignment, review or ordinary
delegated grant/revocation. The browser acceptance journey uses these UI controls.
The preserved reviewer operator commands are emergency tools. New access-manager
appointments/ceiling changes remain exceptional operator governance. Bulk management,
a full access-event viewer, larger reviewer directories and multi-party governance
are deferred, with precise limits in the runbook. The pilot grants no unrestricted
confidential readiness.

## Validation evidence

All integration checks use the existing sanitized-source harness, separately guarded
fresh PostgreSQL clusters at 55433, manifest/role/data-directory identity checks,
captured email and mocked scanner responses. No private env/capture/storage is copied
from the project. External server/browser fetches are blocked. Entire disposable
clusters are stopped/disposed; no history trigger bypass or row-history cleanup runs.
The persistent endpoint 55432 and existing listeners are retained.

| Check                                                | Result                                                                                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test -- --reporter=dot`                         | 71 passed across 15 files                                                                                                                                               |
| `npm run typecheck`                                  | Passed                                                                                                                                                                  |
| `npm run db:test:unit`                               | 3 passed; existing local ownership/endpoint guards retained                                                                                                             |
| `npm run test:phase422` production snapshot build    | Passed, with existing dependency/deprecation warnings                                                                                                                   |
| Disposable scanner/Bouncer database suite            | 24 passed                                                                                                                                                               |
| Disposable registration/notification suite           | 13 passed                                                                                                                                                               |
| Disposable owner-verification/CLI lock suite         | 6 passed                                                                                                                                                                |
| Disposable Phase 4.2.2 security/administration suite | 12 passed                                                                                                                                                               |
| Final browser acceptance pass                        | 24 passed across 320, 390, 768 and 1440-pixel viewports; touch on mobile/tablet; axe WCAG A/AA/2.1 AA on exercised screens including new access/intake views            |
| `npm run test:bouncer`                               | 8 passed; injected responses only                                                                                                                                       |
| `npm run test:scanner`                               | 14 passed, 1 installed-daemon test skipped (no local clamd socket)                                                                                                      |
| Launcher regression checks                           | Original fixed-port run: 5 passed, lifecycle blocked by existing port-3000 listener. Sanitized temporary source copy on 3330: all 6 passed; original listener untouched |
| Offline `db:check` and schema drift generation       | Passed; no schema changes remaining; all 38 forward migrations applied only to disposable clusters                                                                      |
| ESLint of changed/new code                           | Passed, 0 errors/warnings; whole legacy repository lint was not rerun                                                                                                   |
| `git diff --check`                                   | Passed                                                                                                                                                                  |

Initial sandbox socket failures were retried with local-bind permission. Intermediate
browser runs exposed the intentionally changed confirmation assertion, the existing
20 MiB file-transfer action's short timeout, and a case-sensitive captured-mail test
lookup. The assertion/lookup were corrected; the exact-limit action now allows 60
seconds without changing the upload size/business limits. No intermediate failing
run is represented as successful final evidence. Existing aborted-request logs during
browser navigation remain; they do not establish provider or inbox delivery.

Private ignored evidence is under `.local/phase422-*.log` and
`.local/phase42-results/` (snapshot build, DB suites, final browser JSON/screenshots).
Only synthetic accounts/PDFs appear. Mobile administration screenshots were visually
inspected for wrapping, controls, confidential routing and retained institutional
styling. Physical browser/assistive-technology acceptance remains distinct.

The new database suite checks:

- No implicit administrator/coordinator/access/reviewer powers; runtime cannot read
  new evidence tables or execute the operator bootstrap function.
- Wrong bootstrap confirmation and repeat bootstrap fail; explicit capabilities,
  approval history and actual database operator are recorded without reviewer grant.
- Live Better Auth cookies, strict Origin and strict action schemas; anonymous and
  forged actor fields fail. Same invitation request replays once; concurrent proof
  acceptance has one winner and one reviewer grant.
- Delegation ceilings, direct reviewer/admin/access-manager grants, self-grants,
  mailbox changes and changed-intent retries are rejected.
- UI-issued invitation cancellation, pending duplicates, permanent mailbox-change
  invalidation, one-hour expiry and audited replacement remain fail closed.
- Both confidentiality states submit; duplicate/rollback produce no extra intents;
  confidential intake projection and direct submission/notes isolation hold.
- Worker lease interruption/reclaim, injected failure/retry, stable sender/recipient/
  idempotency snapshots, no duplicate completed send and minimal email content.
- Coordinator self-assignment to another author, author self-review rejection,
  stale revision rejection, author assignment projection, existing assignment mail,
  start/return/amend/new assignment/accept, author-note isolation and confidential
  accepted-resource isolation.
- Assignment/reviewer revocation fences actionable mail, clears sessions and future
  access, retains review history, and zero-coordinator evidence remains inspectable.
- Break-glass revoke/recover and live clergy-grant revocation retain evidence.

## Outstanding prerequisites

The persistent database must receive reviewed forward migrations and the first
administrator must be independently verified/provisioned through the documented
operator procedure before using the new features there. Neither action was performed
automatically. The given identities' current state was not inferred from their IDs.

Actual provider/inbox acceptance, worker scheduling/monitoring, real Bouncer transfer
and scanner/live-contract acceptance remain separately authorized work. Physical
mobile/Safari/Firefox and human assistive-technology acceptance remain unexecuted.
Privacy notice/legal/contact/retention approvals, scanning/quarantine operations,
infrastructure/process roles, shared rate limits/capacity, deliverability, key custody,
backups/restore, quotas and all existing release prerequisites remain open. Chat,
Google OAuth, deployment and unrelated legacy interfaces/PWA/outbox are unchanged.
Michael's attribution and all existing private environments/data are retained.
