# Phase 3A implementation report

Implemented locally on **5 November 2026**, Africa/Johannesburg, on
`feat/self-hosted-migration`. Started with a clean working tree tracking the same
origin branch. No commits, pushes, merges, history rewrites, deployment, real
Supabase access or Phase 3B work were performed. Michael's original conception
and Lovable development attribution are retained in the README.

## Outcome and scope

Self-hosted clergy registration, mandatory email verification, email/password
login, database-backed cookie sessions, logout, password recovery, pending-profile
provisioning and account-status/recovery pages work locally without Supabase.
Better Auth remains pinned at **1.7.16**, with its matching Drizzle adapter; Drizzle
ORM 0.45.4/Kit 0.31.11 and the existing TanStack Start/Node configuration are retained.
Official Resend SDK **6.37.0** is the only added direct package. The lockfile adds
its dependencies without upgrading the existing package resolutions.

This is a completed local Phase 3A implementation, **not production-ready software**.
Legally reviewed privacy wording, the real verified sender domain, production
infrastructure and approval workflows are unresolved dependencies. No live Resend
message was sent. No browser E2E claim is made.

## Files created and modified

| Files                                                                                   | Purpose                                                                                                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `database/migrations/0004_clergy_provisioning.sql`                                      | Constrained pending-profile provisioner and suspension/session trigger.                                                         |
| `database/migrations/0005_provisioning_audit_outcome.sql`                               | Forward correction to existing audit enum; no applied migration rewritten.                                                      |
| `database/migrations/meta/{0004_snapshot.json,0005_snapshot.json,_journal.json}`        | Additive custom migration metadata; no schema table changes.                                                                    |
| `database/runtime-grants.sql`                                                           | EXECUTE on one new provisioning function, no new app table writes.                                                              |
| `database/runtime.server.ts`                                                            | Explicit UTC runtime DB sessions for generated auth timestamps.                                                                 |
| `database/auth/config.server.ts`                                                        | Existing factory extended with trusted origin/cookies, transactional adapter, password/reset/email options and rate limits.     |
| `database/context.server.ts`                                                            | Update comments to reflect actual live session integration; transaction boundary unchanged.                                     |
| `database/integration.test.ts`                                                          | Expected ledger count changes from four to six; existing security assertions retained.                                          |
| `database/phase3a.test.ts`                                                              | Real restricted PostgreSQL auth/authorization/failure integration tests.                                                        |
| `src/lib/auth/{registration.ts,client.ts,runtime.server.ts,service.server.ts}`          | Strict schemas/draft notice, reusable client, lazy server configuration and HTTP auth/account service.                          |
| `src/lib/email/{templates.server.ts,service.server.ts,email.test.ts}`                   | Provider abstraction, SDK/capture/test providers, templates, retries/configuration tests.                                       |
| `src/routes/api/auth/$.ts`                                                              | TanStack Start GET/POST authentication route.                                                                                   |
| `src/routes/{auth.tsx,account.tsx}`                                                     | Registration/login/verification/resend/reset and live account status/onboarding UI.                                             |
| `src/components/{RegistrationFields.tsx,SiteHeader.tsx}`                                | Accessible shared fields/privacy acknowledgement; new account navigation.                                                       |
| `src/routes/_authenticated/route.tsx`, `src/routes/offline.tsx`                         | Isolate deferred legacy Supabase workflows with unconditional account redirects.                                                |
| `src/routes/__root.tsx`                                                                 | Remove Supabase session subscription, legacy message synchronization and preview error telemetry from the public/account shell. |
| `src/routes/index.tsx`, `src/routeTree.gen.ts`                                          | Registration navigation search state; generated route declarations.                                                             |
| `src/server.ts`                                                                         | Account/auth HTML has no-store and no-referrer response headers.                                                                |
| `src/test/setup.ts`                                                                     | Guard browser-only mocks so server email tests can use Node environment.                                                        |
| `scripts/db/phase3a-smoke.ts`                                                           | Starts/stops built Node server; real HTTP/cookies, capture and fixture cleanup.                                                 |
| `vite.config.ts`                                                                        | Bundle each Zod version in SSR so Better Auth Zod 4 is not misresolved to legacy Zod 3 in Node output.                          |
| `package.json`, `bun.lock`                                                              | Pinned Resend SDK and new integration/smoke scripts.                                                                            |
| `.env.example`, `README.md`, `docs/database.md`, `database/auth/README.md`, this report | Configuration, operation, attribution, boundaries and limitations.                                                              |

Ignored local artifacts: `.env.auth.local` contains a generated local auth secret,
localhost origin and captured-mail defaults. Supplied email settings were transferred
from the tracked `.env` into this ignored 0600 server-only file; the client-exposed
key was renamed to `RESEND_API_KEY`. No credential value was printed or committed;
tracked `.env` is unchanged. Database credentials/data remain in their established
ignored files/directories. Captures contain private links and are not public assets.

## Authentication and session integration

The official TanStack Start file-route GET/POST pattern invokes the existing
Better Auth factory through a server-only lazy singleton. The service validates and
allowlists public operations, then calls Better Auth's supported API/handler. It
preserves Set-Cookie headers and returns generic UI results instead of JSON session
tokens. The reusable Better Auth client and account request helper use same-origin
cookies; passwords/tokens are never persisted in browser storage by this flow.

There are no auth server actions, so the optional `tanstackStartCookies` plugin is
not required; cookie-bearing Response headers are returned directly from handlers.
The origin comes exclusively from explicit `BETTER_AUTH_URL`. Remote origins must
be HTTPS; localhost supports development HTTP. Cookies are HttpOnly, SameSite=Lax,
and Secure for HTTPS. Cookie caching stays disabled and sessions are checked against
the database. Logout deletes the server session; reset revokes all existing sessions.

CSRF/origin checks are not disabled. Custom POST handlers require the exact configured
Origin. Redirects in mail are fixed by the server; browsers cannot supply arbitrary
callbacks. Raw Better Auth signup/user-update/deletion/get-session endpoints are
not exposed. Application authorization never relies on a session alone.

## Registration lifecycle and transactional guarantees

1. Strict server validation checks trimmed/normalized lowercase email, title, name,
   ministry, optional phone, password confirmation, 12–128 character passwords,
   explicit acknowledgement and exact displayed draft-notice version. Unknown
   role/status/identity properties are rejected. Password hashing belongs to Better Auth.
2. Better Auth creates the identity and credential account in its own transaction
   (`drizzleAdapter(..., transaction: true)`). It issues no signup session.
3. The returned identity is checked by **ID and email**, not matched by email alone.
   Better Auth's synthetic duplicate-signup identity cannot provision or overwrite
   the existing person. Unique-email constraints handle concurrent registrations.
4. A second scoped transaction invokes `app.provision_clergy`, atomically creating
   the pending profile, clergy role, initial pending approval event, explicit
   repository consent event and audit event. No reviewer/admin/approved argument exists.
5. A verification email is requested after provisioning. Failed provisioning still
   permits verification and later recovery, with a clear retry/recovery response.
6. Unverified login is denied. Verified pending login goes to `/account`; missing
   profiles show explicit onboarding, approved accounts show a future-feature notice,
   and rejected accounts remain denied protected data. Suspended login is denied
   after a live status check and its session is deleted before returning cookies.

Installed source reviewed: `better-auth/dist/api/routes/sign-up.mjs` calls
`runWithTransaction`; the adapter defaults transaction support to **false**, so the
factory now explicitly enables it. `better-auth/dist/db/with-hooks.mjs` queues
after hooks through `queueAfterTransactionHook`. An application query on an
independent postgres.js transaction does **not** join that adapter transaction.
We deliberately use a documented recoverable two-transaction flow, not a claim that
after-create hooks atomically commit application records.

Provisioning locks the real auth identity. It is idempotent under concurrency;
existing profiles cannot be overwritten, approved, or have revoked roles restored.
A failure rolls back the entire application group. If auth commit succeeds but
provisioning fails/crashes, the identity has no approved profile; the person can
resend verification, verify, sign in, re-enter details and explicitly acknowledge
again to complete onboarding. If delivery fails, committed registration remains
recoverable via resend. No owner database connection is used for web requests.

## Database and authorization boundaries

All original app schemas, RLS, fixed-purpose authorization helpers, grants,
append-only history and retention FKs are retained. Runtime gains only EXECUTE on
`app.provision_clergy(text,text,text,text,text,boolean,text)`; it still cannot
INSERT/UPDATE profiles, roles or approval history directly. The SECURITY DEFINER
function has fixed `pg_catalog` search_path, schema-qualified objects, no dynamic
SQL and no PUBLIC execution. The existing context must match its identity argument;
only server-created/verified identities are passed by the service.

Like the Phase 2B boundary, custom GUCs are not cryptographic identity. The server,
parameterized queries and restricted credentials are trusted: stolen runtime
credentials or SQL injection could forge context and mutate auth tables. This
phase does not claim RLS can protect against a compromised trusted server.

Account operations use verified Better Auth sessions and transaction-local identity.
`withApprovedDatabase` additionally checks live `app.is_active()` in the scoped
transaction; purpose-specific repository/chat consent stays in RLS. Missing profiles,
pending/rejected/suspended accounts fail closed. Suspension deletes sessions through
an owner trigger in the same status-update transaction; account/login checks also
revoke any session created after suspension. Requests already in flight have the
usual short-transaction/revocation visibility limits documented in Phase 2B.

Migration `0004` was applied locally before tests caught its audit enum mismatch.
The applied file was preserved and `0005` supplies a forward correction to outcome
`ok`; approval status stays pending. There are six ledger entries, ten app tables
and four generated auth tables. No application-table grants, RLS policies or existing
history were weakened to repair the issue.

## Verification and password recovery

Verification uses Better Auth's one-hour signed JWTs and verified-state persistence.
The pinned library normally treats verification of an already verified account as
success, so the delivery callback stores only SHA-256 token digests in its existing
verification table. The HTTP gate atomically deletes one unexpired digest before
letting Better Auth validate the signed JWT. Concurrent/replayed/expired/tampered
links fail. The gate and Better Auth verification are separate transactions: a
failure burns that link and resend is the explicit recovery route. Verification
never grants approval or creates a session. A pending-registration email follows
successful verification, and failure feedback links back to sign-in/resend.

Forgot-password and verification-resend responses are generic for nonexistent,
verified and eligible accounts, including delivery failures; failures remain
observable through safe event categories. They do not promise actual delivery.
Password-reset tokens and their atomic consumption are entirely Better Auth-managed,
expire after one hour and cannot be reused. Successful reset changes the password
and revokes sessions transactionally. Reset/verification pages and responses use
no-referrer/no-store; preview telemetry was removed from this shell.

## Email architecture and environment

`EmailProvider.send` separates business logic from delivery. `EmailService` owns
sender/reply-to, trusted-origin checking, templates, stable idempotency keys and safe
failure reporting. Providers are `ResendEmailProvider`, `DevelopmentEmailProvider`
and `TestEmailProvider`. Templates have HTML and plain-text content for verification,
reset and pending approval; approval/rejection templates are prepared but unused.
No passwords, documents or confidential messages are emailed.

The Resend provider uses the official SDK, checks both returned errors and delivery
IDs, retries transport/transient failures at most three times with bounded backoff,
and reuses the same payload/idempotency key. Permanent errors fail immediately.
Only event categories/template kind are logged, never addresses, links, tokens,
provider payloads, passwords or credentials.

| Variable                    | Meaning                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `CAPE_RUNTIME_DATABASE_URL` | Existing restricted, guarded local database URL.                                     |
| `BETTER_AUTH_SECRET`        | Explicit random server-only secret, at least 32 characters.                          |
| `BETTER_AUTH_URL`           | Exact trusted application origin, no trailing slash; localhost HTTP for development. |
| `EMAIL_PROVIDER`            | Defaults to local development capture; `resend` explicitly opts into real delivery.  |
| `RESEND_API_KEY`            | Server-only SDK credential; never a VITE variable.                                   |
| `EMAIL_FROM`                | Configured real verified sender for Resend; no Diocese domain assumed.               |
| `EMAIL_REPLY_TO`            | Optional configured reply address.                                                   |
| `EMAIL_DOMAIN_VERIFIED`     | Must equal `true` with real credentials/sender to enable Resend.                     |
| `CAPE_LOCAL_EMAIL_CAPTURE`  | Explicit localhost-only override for captured email under the Node production build. |

Development writes `.local/email/*.json`, directory 0700/files 0600. Open the
captured link yourself; there is no public inbox endpoint or token logging. Tests
inject an in-memory provider and forbid external fetch. The Node smoke uses private
file captures, never Resend. Production mode fails closed without explicit Resend
configuration unless the explicit capture flag is used with localhost.

Setup and commands are in [README.md](../README.md). The ignored local auth settings
already contain a generated local secret, localhost:3000 and fake-delivery selection.
Do not put the owner URL in the running application environment.

## Validation and commands executed

Read-only inspection covered AGENTS.md, both prior reports, database schemas,
policies/grants, safety/integration tests, auth/client routes, Start/Vite configuration,
installed package sources and versions. No external database was consulted.
Dependency installation used `BUN_INSTALL_CACHE_DIR=/tmp/cape-bun-cache bun add --exact resend`;
network access and localhost sockets required sandbox escalations. No automatic
approval rejection occurred. All subsequent database work used the guarded tooling.

| Command/check                                                                                     | Result                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run db:generate --custom --name=clergy_provisioning` and `--name=provisioning_audit_outcome` | Two additive SQL/journal/snapshot entries.                                                                                                                                |
| `bun run db:local:start`, `db:migrate`, `db:runtime:setup`                                        | Guarded cluster started; reviewed migrations/grant applied; no unknown databases accessed.                                                                                |
| `bun run typecheck`                                                                               | Passed strict TypeScript.                                                                                                                                                 |
| `bun run test`                                                                                    | 7 files, 27 tests passed (all original 23 plus four email tests).                                                                                                         |
| `bun run db:test:unit`                                                                            | 3 safety tests passed.                                                                                                                                                    |
| `bun run db:test`                                                                                 | 3 integrity/history/ledger tests passed.                                                                                                                                  |
| `bun run db:test:auth`                                                                            | 10 existing restricted-role authorization/context/auth tests passed.                                                                                                      |
| `bun run db:test:phase3a`                                                                         | 12 tests including parent passed; real HTTP Request handlers and restricted PostgreSQL.                                                                                   |
| `bun run db:check`                                                                                | Passed migration metadata check.                                                                                                                                          |
| `bun run build`                                                                                   | Passed client/SSR/PWA/Node build with Zod versions correctly resolved.                                                                                                    |
| `bun run db:smoke:phase3a`                                                                        | Passed built Node HTTP registration, capture, verification, cookie login, pending state, legacy isolation, logout. Child server stopped; owned fixtures/captures cleaned. |
| Focused ESLint/Prettier                                                                           | Passed on changed/new implementation and test files.                                                                                                                      |
| Client artifact secret scan and `git diff --check`                                                | Passed; no configured auth/email/runtime secret values in client assets.                                                                                                  |
| `bun run db:local:stop`                                                                           | Cluster stopped with data retained after validation.                                                                                                                      |

New integration cases cover strict forged-field rejection, exact origins/unsafe
callbacks, denied raw auth routes, normalized registration, duplicate/concurrent
accounts, explicit consent, pending/clergy-only provisioning, JWT expiry/digest
expiry/replay/tampering, verification without approval, unverified rejection, live
pending/rejected/suspended denial, concurrent fresh session tokens, HTTPS Secure
cookie attributes, missing/forged sessions, provisioning idempotence, password-reset
expiry/invalid/reuse and session invalidation, logout, failed email recovery,
missing-profile recovery after deliberately denied provisioning, and resend abuse.
The existing suite retains cross-account/RLS, consent withdrawal, query-context
reset/concurrent pool reuse, SQL-injection-safe parameter boundaries and privilege
escalation negatives. Unit tests cover provider errors, bounded retries/idempotency,
production configuration refusal and offline/captured email without network delivery.

## Remaining limitations and Phase 3B decisions

- **Privacy:** existing wording is displayed in full and labelled as a local draft.
  No evidence of legal approval was supplied. Adopt reviewed notice text and versions
  through a future migration; repository and private-chat consent stay independent.
- **Mail:** real sending domain/ownership verification and deliverability are untested.
  Captured email is the verified local path. A failed post-verification pending email
  is logged; verification remains persisted, so the person can sign in. There is no
  durable notification queue; retries after process crashes and guaranteed delivery
  belong to the later notification work.
- **Rate limiting:** explicit global/operation limits and HMAC-email resend/reset
  cooldowns apply in this single Node process. Better Auth's own handler limits also
  remain enabled. Shared persistent throttling/proxy trust/edge IP controls are
  required before multiple processes or deployment. Timing-based enumeration
  resistance is not claimed for real-provider latency.
- **Recovery:** a process crash after auth creation can leave an incomplete profile;
  verify/login/onboarding recovers safely. A failed verification request consumes the
  single-use digest and needs resend. Expired verification metadata is cleaned by
  Better Auth's normal verification cleanup; there is no dedicated maintenance job.
- **UI validation:** real built Node HTTP/cookie flows were exercised, including HTTPS
  cookie-attribute construction in integration tests. No interactive browser engine,
  mobile-device, screen-reader or browser E2E suite was run.
- **Workflow:** repository/document storage/reviewer/chat/Google OAuth/account migration
  remain deferred. Legacy routes are blocked, source retained, and no old session is
  interpreted as a Better Auth identity. Legacy draft data remains on the device.
- **Phase 3B:** decide trusted administrative bootstrap, reviewer mailbox proof and
  authorization, Revd Chesnay's exact approval permissions, approval/rejection/suspension
  services with immutable history, notification delivery semantics and reviewed privacy
  notices. Do not infer administrator privilege from an email comparison.

Recommended next work is review of this Phase 3A diff and privacy/sender dependencies,
then separately scoped Phase 3B approval services/dashboard and their authorization
and notification tests. Production runtime provisioning, TLS/secrets, persistent rate
limits and durable delivery need their own review before release. Phase 3B was not begun.

## Reference material

The installed 1.7.16 source is authoritative for transactional/token behavior in this
implementation. Official integration/provider references consulted:

- [Better Auth TanStack Start integration](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/integrations/tanstack.mdx)
- [Better Auth email/password](https://github.com/better-auth/better-auth/blob/main/docs/content/docs/authentication/email-password.mdx)
- [Resend official Node SDK](https://github.com/resend/resend-node)
- [Resend idempotency design](https://www.resend.com/blog/engineering-idempotency-keys)
