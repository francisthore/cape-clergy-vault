# Phase 3B — clergy approval administration

Implemented locally on 5 November 2026 (Africa/Johannesburg), on
`feat/self-hosted-migration`, starting from clean HEAD `75feef3` (Phase 3A).
Michael's original concept and Lovable development remain attributed in README.
No branch switch, commit, push, merge, history rewrite, deployment or production
service change was performed. Phase 3C has not begun.

## Implementation and file inventory

| Files                                                                                 | Result                                                                                                                                                                       |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore`, `.env.example`                                                          | Root/nested `.env*` ignored except `.env.example`; example documents the current runtime boundary and contains placeholders only.                                            |
| `.env`                                                                                | Removed from the Git index using `git rm --cached -- .env`; original working copy retained byte-for-byte. This is a staged tracking removal, not deletion of the local file. |
| `database/schema/approval.ts`, `database/schema/{profiles,index}.ts`                  | Dedicated approver enum value and internal bootstrap/outbox schemas.                                                                                                         |
| `database/migrations/0006_approval_administration.sql`, `0007_approval_security.sql`  | Additive tables/role, fixed-purpose authorization/query/decision/bootstrap functions, receipt triggers and checks.                                                           |
| `database/migrations/meta/{0006_snapshot,0007_snapshot}.json`, `_journal.json`        | New schema snapshots and appended migration entries; previous entries/snapshots unchanged.                                                                                   |
| `database/runtime-grants.sql`                                                         | Five specific approval function EXECUTE grants; internal tables explicitly denied; no direct profile/role/history mutation grants.                                           |
| `src/lib/approvals/{service.server,runtime.server,types}.ts`                          | Verified-session application service, strict input and origin checks, capped POST bodies, live authorization, minimal responses and browser request/types.                   |
| `src/lib/approvals/notifications.server.ts`                                           | Operator-only durable outbox delivery, separate from web requests.                                                                                                           |
| `src/routes/api/registrations.ts`                                                     | GET list/detail and POST decision endpoint; no bootstrap or worker endpoint.                                                                                                 |
| `src/routes/admin.registrations.index.tsx`, `admin.registrations.$userId.tsx`         | Responsive list/detail, status/search/pagination, decision reasons/dialogs and history.                                                                                      |
| `src/routeTree.gen.ts`, `src/server.ts`                                               | Generated route registration; server guard for direct admin page requests and private-page no-store headers.                                                                 |
| `src/lib/auth/{service.server,client}.ts`, `src/routes/account.tsx`                   | Live approval-capability navigation from the account page; direct post-verification receipt delivery replaced by transactional queue triggers.                               |
| `src/lib/email/{service.server,templates.server,email.test}.ts`                       | Optional durable-event idempotency key; all five approval lifecycle templates in HTML/plain text; existing providers retained.                                               |
| `scripts/db/{bootstrap-approver,approval-notifications,phase3b-smoke}.ts`             | Guarded interactive bootstrap, bounded operator worker and built Node HTTP smoke coverage.                                                                                   |
| `database/phase3b.test.ts`                                                            | New real restricted-role authorization/security/integration tests.                                                                                                           |
| `database/{integration,authorization,phase3a}.test.ts`, `scripts/db/phase3a-smoke.ts` | Current ledger/table assertions, durable receipt assertion and fixture-outbox cleanup.                                                                                       |
| `package.json`                                                                        | Bootstrap, notification, Phase 3B test and smoke commands; no dependency upgrades.                                                                                           |
| `README.md`, `docs/database.md`, this report                                          | Current architecture, runbooks, validation, attribution and limitations.                                                                                                     |

No other file was removed from tracking. Historical application migrations `0000`–`0005`,
all their snapshots, historical `drizzle/` SQL and `supabase/` are unchanged.

## Permission model

| Responsibility       | Permission                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clergy               | Ordinary application role; protected content still requires approved status and purpose-specific current consent.                                                          |
| Clergy approver      | Dedicated active `approver` grant **and** approved profile **and** verified auth identity. Registration administration only.                                               |
| Theological reviewer | Existing `reviewer` role and existing content/consent rules; approval does not grant it.                                                                                   |
| System administrator | Existing broad `admin` role remains functional, including its historical reviewer implications. It is not granted by this workflow and does not substitute for `approver`. |

Only explicit approver grants authorize these administrative services. Existing
submission, document and chat policies/helpers do not recognize the new role.
Approvers receive no general access to other profiles/history through RLS: narrow
SECURITY DEFINER list/detail functions return selected registration fields. Approval
changes account status only and never adds reviewer or admin roles.

Every operation uses Better Auth's database-verified cookie session with cookie
cache disabled, verified email, the existing transaction-local request boundary,
and live database permission checks. The browser cannot supply the actor/role.
Unknown actor/role/status properties are rejected. Missing context fails closed.
Revocation applies on subsequent authorized requests. In-flight short transactions
may finish before a waiting revocation commits; instantaneous revocation of already
running operations is not claimed.

As before, PostgreSQL custom settings are not cryptographic identity. The trusted
server and parameterized queries establish identity; stolen runtime credentials,
SQL injection or malicious server code remain outside this protection. Better Auth
still needs auth-table CRUD. No competing identity or authorization system was added.

## Initial approver bootstrap runbook

No real identity was created, invented or bootstrapped. Revd Chesnay must register
normally and verify her email before a trusted operator proceeds.

1. Start the guarded project-local cluster, apply migrations, then apply runtime grants:
   `bun run db:local:start`, `bun run db:migrate`, `bun run db:runtime:setup`.
2. Independently confirm the intended person through the established trusted local
   operator process. Obtain the **exact Better Auth identity ID** from the registered
   account using guarded owner tooling. An email/name lookup alone is not authority.
3. From an interactive trusted terminal run:
   `bun run db:bootstrap:approver EXACT_ID`.
4. Review the displayed identity ID, name, email, verification and current status,
   and the stated registration-only permission. Type exactly
   `GRANT APPROVER EXACT_ID` when prompted. Any mismatch fails.
5. The database transaction requires a verified existing pending/approved clergy
   profile and live clergy grant, approves it, adds only `approver`, appends approval
   history/security audit/approved-email intent, and creates an immutable singleton
   bootstrap marker. The operator action is identified in the history reason;
   the database actor/target is the exact designated identity, not an invented
   application identity for the local operator.
6. Sign in and open `/account`, then **Manage clergy registrations**. Run the
   notification worker separately to deliver queued messages.

The marker table lock serializes competing bootstrap attempts. An existing marker
or any previous approver assignment, including a revoked assignment, blocks another
bootstrap. It cannot be reused to add privileged users. The CLI requires a TTY and
one exact-ID argument; no build, startup, migration, HTTP endpoint, special URL,
client-supplied claim or hardcoded email/password invokes it. Runtime has no EXECUTE
on `bootstrap_approver`. Additional approvers, lost-authority recovery and deliberate
privilege revocation require separately reviewed operator maintenance; this phase
provides no public or casual “reset bootstrap” path. Trusted schema owners can alter
triggers/functions and remain outside the runtime threat boundary.

Disposable bootstrap tests use an owner transaction that always rolls back, leaving
no marker or privileged fixture. Built HTTP tests seed only explicitly named
disposable authority and remove it afterward; they do not establish a real bootstrap.

## Dashboard and server API

- `/admin/registrations`: defaults to pending, filters all four states, searches name,
  parish/ministry or email, and uses PostgreSQL ordering and 20-row server pages.
  Pending rows sort first in the all-status list. The page shows title/full name,
  parish, email, verification, registration date and approval status. Phone and
  credential/auth metadata are not returned.
- `/admin/registrations/{userId}`: minimal profile, verification/status, timestamp
  and previous immutable decisions with actor display name/ID, reason and time.
- `GET /api/registrations?status=pending&search=...&page=1` or `?id=EXACT_ID`:
  authorized database list/detail functions. No browser-supplied actor context.
- `POST /api/registrations`: strict `{ targetId, action, reason, requestId }` input;
  UUID request ID, exact trusted Origin, stream-limited 4096-byte body and bounded
  field lengths. Authenticated actor comes exclusively from the server session.

Direct HTML requests are authorized in the Node entry before rendering, without
reading registration rows. Client transitions fetch data through the protected API.
No registrations are serialized into initial SSR HTML. API/private-page responses
use `Cache-Control: no-store`, `Vary: Cookie` and no-referrer. The PWA caches only
static assets, with no navigation/API caching. The UI refreshes while open and on
focus, clears loaded data before rechecking, uses labelled controls and accessible
Radix confirmation dialogs, and blocks simultaneous submissions. A request UUID is
retained for retries of the same open decision intent. Server idempotency/state
validation also protects against duplicates after uncertain transport failures.
Errors provide generic authorization, validation/conflict or temporary-unavailability
messages without SQL, tokens, payloads or credentials.

## Allowed transitions and consistency

| Action     | Required starting state | Additional conditions                          | New state |
| ---------- | ----------------------- | ---------------------------------------------- | --------- |
| Approve    | pending                 | Verified email; target differs from actor      | approved  |
| Reject     | pending                 | Nonblank reason, at least 3 trimmed characters | rejected  |
| Suspend    | approved                | Reason; target differs from actor              | suspended |
| Reactivate | suspended               | Reason, verified email, live clergy role       | approved  |

All actions require a live eligible approver; self decisions are denied for all
four actions. Reasons are limited to 1000 characters. There is no rejected-to-approved
transition or implicit reconsideration. Reactivation never restores revoked reviewer
or system roles and creates no session; the person must sign in again. Protected
repository/chat consent is still enforced separately by existing RLS.

`decide_registration` locks the actor's profile, auth identity and approval assignment
against conflicting changes, then the target auth/profile rows. Target-state checks,
verification checks, status projection, immutable approval event, ID-only audit event
and durable notification intent share one transaction. The preexisting suspension
trigger deletes every target session in that same transaction. Failed transactions
roll everything back, including session deletion and success evidence. Conflicting
concurrent decisions have one winner; deadlocks are rolled back and returned as a
conflict requiring a fresh status check. A replayed UUID returns the prior event
only when actor, target, action and reason match; it does not append another event
or email intent. A changed intent or duplicate transition fails.

History mutation triggers continue to reject UPDATE/DELETE/TRUNCATE. A new trigger
protects the bootstrap marker. Runtime still cannot directly mutate profiles, roles
or approval history. SECURITY DEFINER functions use fixed `pg_catalog` search paths,
schema-qualified objects, no dynamic SQL and no PUBLIC execution. Runtime gains
only EXECUTE on `is_approver`, `require_approver`, `registration_list`,
`registration_detail` and `decide_registration`. The owner-only bootstrap function
and trigger functions receive no runtime EXECUTE. Internal tables have RLS and no
runtime table privileges; no read policy exposes their contents.

## Email and durable delivery

Registration receipt intent is queued by database triggers once a verified identity
and provisioned pending profile both exist. Both orderings work, including verified
identity recovery through profile completion. `registration:IDENTITY_ID` uniqueness
prevents duplicate receipts. Approval, rejection, suspension and reactivation intent
is stored with each committed decision, keyed by its UUID. Receipt email goes to
the applicant; approvers review registrations in the dashboard. No unconfigured
Diocese contact or administrative distribution address is invented.

All five lifecycle templates use the existing EmailService/providers, HTML and
plain text, minimal status information and the configured trusted `/account` URL.
Decision reasons and confidential material are not emailed. Receipt text directs
the recipient to current account status so delayed delivery does not assert that
an already-decided registration is still pending.

Run `bun run db:notifications` to process a batch of up to 20 intents. This guarded
operator-only command loads `.env.db.local` and `.env.auth.local`, not browser input.
It claims rows with `FOR UPDATE SKIP LOCKED`, increments attempts and commits a
five-minute lease. Provider I/O happens **after commit**, outside a transaction.
Success records delivery time; failure records only `delivery_failed` and schedules
exponential backoff (60 seconds initially, capped at one hour). Up to eight attempts
are allowed. Unexpired leases prevent concurrent claims; expired leases allow
recovery after a process dies. The per-row `approval:UUID` key survives retries and
process restarts and is passed to the existing Resend idempotency mechanism.
The command reports delivery and exhausted counts without addresses/payloads.

**Operational dependency:** schedule the command at least once per minute and alert
on exhausted/persistently pending rows before relying on delivery. Nothing installs
a scheduler, daemon or production service here. The local foundation uses guarded
owner tooling for the worker, rather than widening web-runtime access to all queued
recipients. A dedicated restricted production worker identity is future deployment
work. Keep sender, origin and recipient account configuration stable while retries
are outstanding. This phase exposes no account email-change workflow.

This is durable notification intent and bounded at-least-once processing, not
exactly-once inbox delivery or proof that a recipient read a message. A crash after
provider acceptance but before the delivery update is ambiguous; provider keys help
within the provider's retention window, which is not an indefinite deduplication
guarantee. Long outages, changed configuration or expired provider keys require
operator reconciliation with provider evidence before any deliberate retry of an
exhausted/ambiguous item. There is no automatic unlimited replay/reset. Permanent
provider failures also exhaust the bounded queue and require review. Development
and tests capture messages, and no real Resend delivery was tested.

## Environment tracking and historical exposure

`.gitignore` now uses `.env*` and `!.env.example`, verified for root and nested paths.
A tracked-file audit finds **only `.env.example`**. The root `.env` was untracked
using `git rm --cached`, never `git rm .env`; its bytes match the original HEAD
version. `.env.auth.local`, `.env.db.local`, `.env.db.runtime.local` remain intact
and ignored. `.local/email`, project-local PostgreSQL data and credentials are
ignored. `.env.example` has documentation, empty mail settings and explicit
replacement placeholders; configured private credentials do not appear in it.

Removing an entry from the current index does **not** erase it from historical
commits. The inspected former tracked file contains legacy Supabase publishable
configuration, intended as client configuration; no private server credential was
identified in that inspected file. This is not a forensic audit of every historical
blob. If any private API key/password/service credential is identified in historical
commits, treat it as exposed and rotate it at its provider; do not copy it into an
issue/report or rewrite published Lovable history. No values are reproduced here.

## Validation and exact results

All database work used the established guarded `127.0.0.1:55432` project cluster,
`cape_clergy_vault_dev`, with its existing owner/runtime roles and identity/marker
checks. No external Supabase connection, production data or other project database
was touched. Network use in tests is forbidden or mocked; built Node tests use
private captured mail and explicitly override any real sender/provider settings.

| Command or check                                              | Result                                                                                                                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run typecheck`                                           | Passed strict TypeScript.                                                                                                                                                                                 |
| `bun run test`                                                | 7 files, 27 tests passed.                                                                                                                                                                                 |
| `bun run db:test:unit`                                        | 3 safety tests passed.                                                                                                                                                                                    |
| `bun run db:test`                                             | 3 integrity/history tests passed; 8 migration ledger entries, 12 RLS app tables, 4 auth tables.                                                                                                           |
| `bun run db:test:auth`                                        | 10 existing restricted-role/RLS/context/Better Auth tests passed.                                                                                                                                         |
| `bun run db:test:phase3a`                                     | 12 authentication/registration tests passed with durable-receipt assertion.                                                                                                                               |
| `bun run db:test:phase3b`                                     | 17 tests passed, including parent; actual restricted runtime and real verified Better Auth cookies.                                                                                                       |
| `bun run db:check`                                            | Passed.                                                                                                                                                                                                   |
| `bun run db:generate` after implementation                    | No schema changes.                                                                                                                                                                                        |
| `bun run db:migrate` and `bun run db:runtime:setup`, repeated | Passed initial apply and repeat; credentials retained, only expected existing-ledger notices.                                                                                                             |
| `bun run build`                                               | Passed client, SSR, PWA and built Node output.                                                                                                                                                            |
| `bun run db:smoke:phase3b`                                    | Passed built Node HTTP registration, verified cookies, denied page/API access, authorized list/detail routes, approval, idempotency, revocation and logout; fixtures/captures cleaned and server stopped. |
| `bun run db:smoke:phase3a`                                    | Passed existing built Node HTTP registration, captured verification, cookie login, pending state, legacy-route isolation and logout.                                                                      |
| Focused ESLint                                                | Passed on all changed/new handwritten TypeScript/TSX, including services, routes, tooling, tests and schema.                                                                                              |
| Focused Prettier                                              | Passed on implementation, tests, schema, package manifest and documentation.                                                                                                                              |
| `git diff --check`                                            | Passed.                                                                                                                                                                                                   |
| Browser artifact scan                                         | Passed: configured private auth/email/database values absent from `.output/public`.                                                                                                                       |
| Environment and preserved-file audit                          | Passed: only example tracked, original root `.env` retained, root/nested ignore rules and example exceptions correct; previous SQL/snapshots/Supabase source unchanged.                                   |
| Browser E2E                                                   | Not run: no browser tool/engine available. HTTP tests are not browser, keyboard or screen-reader E2E coverage.                                                                                            |

New cases cover exact-ID/confirmation/verified/one-time bootstrap, denied HTTP bootstrap,
verified/profile receipt prerequisites, all unauthorized account states, minimal list/detail,
server pagination/search, self decisions, forged actor/role, origin/validation, unverified
approval, atomic evidence/intent, immutable history and restricted grants, conflicting
concurrency, rejection/reconsideration denial, session revocation, conditional reactivation,
live permission revocation, reviewer/chat/confidential isolation, transaction rollback,
failed delivery, deduplicated delivery, crash lease recovery, concurrent claims and retry
exhaustion. Existing suites preserve all original consent/RLS/auth tests. Simulated mail
failure tests intentionally emit safe category-only failure messages.

`bun run db:local:stop` passed after the final HTTP smoke test; the private test
cluster is stopped with data retained.

Initial validation encountered sandbox socket/index restrictions; explicitly requested
operations were rerun with reviewed access, without an approval rejection. The first
typecheck preceded route generation, then caught an incorrect trailing slash on an
internal Link; route generation/link correction resolved it. Final checks pass. No
applied migration was edited to repair a failure.

## Remaining risks and recommended Phase 3C scope

- Provision the real intended approver only after independent operator review of her
  verified exact identity. No real privileged account was established in this work.
- Schedule/monitor the outbox and establish sender-domain verification, provider
  reconciliation, dedicated worker permissions and production credentials before
  real delivery. Delivery/domain ownership were not tested with Resend.
- Existing local-only database guards, single-process rate limits, draft privacy
  notices, retention/anonymization decisions and production TLS/secrets/provisioning
  remain release dependencies from prior phases. This is not deployment approval.
- Mobile layouts and labelled/Radix controls are implemented but require real browser,
  device, keyboard and screen-reader acceptance checks before release.
- No reviewer invitation/management, reconsideration, additional-approver provisioning,
  email-change, storage/download, document review, chat or Google OAuth was added.

Recommended Phase 3C is a separately approved private document/storage migration:
private object keys, RLS rechecks, short-lived audited download URLs, upload validation
and explicit reviewer-authority design that preserves mailbox proof and confidentiality.
Keep reviewer provisioning and TEFT chat separately scoped; do not repurpose `approver`
for theological review. Resolve reviewed privacy text/versions and release dependencies
before enabling confidential material. Stop at Phase 3B here.
