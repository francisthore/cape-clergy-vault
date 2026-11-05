# Phase 2B implementation report

Completed locally on 5 November 2026 (Africa/Johannesburg), on
`feat/self-hosted-migration`. Better Auth remains inactive to application users.
No authentication cutover, public auth routes, production account migration,
deployment, commit, push, merge or history rewrite was performed. Stop here for review.

## Actual Phase 2A verification

Started with a clean working tree at `69b94a4` (`Add isolated PostgreSQL and Drizzle
foundation for Phase 2A`), tracking `origin/feat/self-hosted-migration`. Read AGENTS.md,
the Phase 2A report, database docs, all application schema modules, the two new-chain
migrations/snapshots, historical Supabase migration references, safety/integrity tests,
connection boundaries, cluster tooling, package/lock/config files.

Verified the actual guarded local database with `db:status`, `db:test:unit` and
`db:test` before changes: 2 safety tests and 3 integrity tests passed. There were ten
application tables with text user identifiers, RLS enabled, no policies, and two
migration ledger entries. Owner connection creation is lazy and guarded; no route
imports that connection. Local start uses the existing project marker and fixed private
data directory, not a system service. Generic/legacy database URLs are ignored.

Architecture corrections before the new FK: add the missing explicit `reviewer` role;
replace auth-free test fixtures with real generated-auth users; retain profile-root
NO ACTION FKs instead of introducing cascades into application/history records.
No applied migration or historical snapshot was edited. Adding the FK deliberately
fails if existing profiles have no auth users; it never invents identities or matches
emails. The local foundation had no retained profiles to reconcile.

## Implementation and versions

Pinned stable `better-auth@1.7.16`, `@better-auth/drizzle-adapter@1.7.16` and the
official `auth@1.7.16` CLI; updated Bun lockfile. Registry peer requirements accept
existing Drizzle ORM 0.45.4 and Kit 0.31.11. The registry's newer 1.7.17 was blocked
by the 24-hour package release-age safeguard; selected 1.7.16 without bypassing it.
No beta dependency was introduced. Existing unrelated beta build tooling remains as before.

Used the installed official generator:

```sh
bun run db:auth:generate
# auth generate --config database/auth/generate.server.ts --output database/auth/generated.ts --yes
bun run db:generate --name=better_auth_identity
bun run db:generate --custom --name=authorization_boundary
```

The generator's configured Drizzle adapter selects PostgreSQL and `schemaName: "auth"`.
Its lazy offline client uses an unusable local port and ignores database credentials;
it never runs a query. Generated output is unmodified, including generator relation
names, snake_case columns, text IDs, timestamps, defaults, uniqueness, indexes and FKs.
Offline generator schema validation is disabled because it starts without table
metadata; runtime validation stays enabled. Regeneration is clean and Drizzle reports
no further schema changes. SQL was reviewed before guarded ORM migration execution.
No push or Better Auth direct migration command was used.

The inactive auth factory takes a guarded runtime connection, explicit secret/base URL
and verification-mail callback. Email/password requires verification. Sessions persist
in PostgreSQL; cookie session caching is disabled. No mail transport, Google provider,
public handler, UI, route import or application-startup connection was added.

## Schema relationships and account lifecycle

Four generated auth tables (`users`, `sessions`, `accounts`, `verifications`) coexist
with the ten app tables. `app.clergy_profiles.user_id` references `auth.users.id` as
text, NO ACTION on deletion/update. Other application relationships still reference
the profile root. Auth account/session cascades remain as generated, but deleting an
auth user with an application profile fails the FK. Audit IDs remain FK-free.
Suspending a profile does not delete authentication or history records.

Profiles keep names/parish/contact information and `pending | approved | rejected |
suspended` application state separately from credentials/sessions. Roles are explicit
`clergy | reviewer | admin`, with existing active-grant uniqueness and revocation
history. Approval alone gives no reviewer powers. No runtime approval, role grant or
profile provisioning privilege exists yet. Auth users without profiles cannot access
protected application content. Future provisioning/revocation needs server integration;
Phase 2B does not install an incomplete automatic registration hook.

## Roles and privileges

The private `cape_local_bootstrap` administrator verifies the exact data directory
before creating only the marked `cape_clergy_runtime` role. Existing unmarked/unsafe
roles or missing existing credentials are refused. No unrelated project's role was
created or altered. The existing `cape_clergy_dev` owns database/schema/tables/functions
and remains responsible for migrations/maintenance, outside the request path.

Runtime is a distinct LOGIN with NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/
NOBYPASSRLS, no memberships, and no owned tables/schemas. Its connector checks actual
identity/marker/endpoint/owner/flags plus ownership, memberships and CREATE/TEMP.
Runtime cannot access the migration ledger, switch to the owner, alter schema/RLS or
triggers, create objects/roles/temp tables, or truncate tables.

Explicit post-migration grants are source-controlled in `runtime-grants.sql` and
applied transactionally by owner tooling: auth CRUD; RLS-limited app SELECT; selected
app inserts; submission status and mute-only updates; sequence USAGE; six authorization
helper functions. History insert grants exclude caller timestamps. Profile/role/approval
writes, app deletes and all DDL remain unavailable. Future functions owned by this
project no longer get default PUBLIC execution; future runtime grants require review.
No identity RLS on auth tables obstructs Better Auth's initial credential/session work.

Random runtime credentials are in ignored `.env.db.runtime.local` (0600), distinct
from owner `.env.db.local` (0600). Cluster directory remains 0700. No real credential
was added to source. The original local database marker is retained deliberately.

## RLS and tested limitations

Nineteen policies cover all ten app tables. SECURITY DEFINER helpers have a fixed
pg_catalog search path, qualified objects, no dynamic SQL, restricted execution and
migration-owner ownership. They read live approval/role/consent state without recursive
RLS. Table owners/cluster administrators remain trusted; FORCE RLS is intentionally
not used because these helpers must inspect the authorization source tables.

- Missing identity denies all app rows and writes. Own profile/consent reads and
  current-version own consent append for pending/approved users are narrow onboarding
  exceptions; they do not reveal repository/chat content. Rejected/suspended users
  cannot append consent.
- Protected repository content requires approved state and latest accepted current
  repository consent. Own submissions are private; others see only accepted,
  non-confidential submissions unless they hold a live reviewer/admin role.
- Document metadata follows parent visibility; writes require own submitted parent
  and own storage-key prefix. Runtime cannot rewrite ownership/confidentiality.
- Only live approved/consented reviewers/admins update submission status or append
  self-attributed review decisions. Reviewer revocation immediately affects later
  READ COMMITTED statements. Approval grants no implicit role.
- Private chat requires current chat consent/approval for caller and conversation
  owner, plus owner identity or live reviewer access. Sender must equal caller.
  Messages cannot be edited/deleted. Mute preferences are scoped to caller and an
  authorized stream, with separate USING and WITH CHECK for updates.
- Audit reads require live approved admin. Append requires an approved self-attributed
  actor; update/delete/truncate are forbidden. Existing append-only triggers on all
  five history tables are preserved and separately exercised as owner.

The current notice versions are migration-maintained local values `repository-v1`
and `private-chat-v1`, not imported production legal notices. Latest obsolete notice
or withdrawal denies access. Future approved notice adoption requires new migrations.

`context.server.ts` prepares a server verifier + headers boundary. It sets only the
verified session user ID with transaction-local `set_config(..., true)`; every app
query must use its transaction client. Commit/rollback and concurrent pool reuse were
tested. Browser role claims/custom role settings are ignored; policies read live roles.

**Trust limit:** custom PostgreSQL settings do not authenticate anyone. A process with
runtime credentials can choose any user-ID GUC and has auth-table CRUD. This design
requires trusted server code, no SQL injection and a genuine Better Auth session
verifier. The factory is not publicly wired; tests use direct fixture identities and
also verify the boundary with a real signed Better Auth session cookie. Future account
disable/session revocation integration is still required. Long transactions/snapshots
can delay revocation visibility; keep requests short. This is not production-ready
end-to-end authorization.

Runtime can append self-attributed audit events; immutable rows do not prove that a
claimed download occurred. Atomic review/projection updates, storage authorization,
audited download URLs, mail delivery, reviewer invitation/fresh-code verification and
push recipient filtering remain server-workflow dependencies. Existing Supabase
protections continue handling the live application.

## Files created and modified

| Files | Result |
| --- | --- |
| `package.json`, `bun.lock` | Pinned auth/adapter/CLI; offline generation, runtime setup and runtime test commands |
| `.env.example`, `README.md` | Placeholder runtime URL and updated inactive-foundation entry point |
| `database/auth/options.server.ts` | Shared password/session/model naming options |
| `database/auth/generate.server.ts` | Credential-free offline official generation config |
| `database/auth/generated.ts` | Official four-table Drizzle output with auth namespace and relations |
| `database/auth/config.server.ts` | Inactive server-only auth factory using restricted runtime connection |
| `database/auth/README.md` | Generation/ownership/inactivity and lifecycle documentation |
| `database/schema/profiles.ts`, `index.ts` | Profile-to-auth FK, explicit reviewer role, integrated exports |
| `drizzle.config.ts` | App plus auth namespace generation, no connection credentials |
| `database/migrations/0002_better_auth_identity.sql` | Generated auth objects, reviewer enum, profile FK |
| `database/migrations/0003_authorization_boundary.sql` | Helpers, grants revocation and 19 policies |
| `database/migrations/meta/{0002_snapshot.json,0003_snapshot.json,_journal.json}` | Additive migration metadata |
| `database/runtime-grants.sql` | Explicit runtime and default function privileges |
| `scripts/db/runtime-setup.ts` | Marked-cluster role provisioning and transactional grants, no password overwrite |
| `database/runtime.server.ts` | Guarded restricted pool, typed separately from owner connection |
| `database/context.server.ts` | Preparatory trusted-session transaction wrapper |
| `database/safety.ts`, `safety.test.ts` | Distinct runtime URL/identity/ownership/privilege guards and negative tests |
| `database/integration.test.ts` | Existing owner integrity suite adapted for real auth users/four migrations |
| `database/authorization.test.ts` | Runtime-login negative/positive security and actual Better Auth API tests |
| `docs/database.md`, this report | Roles, policies, trust limits, setup, recovery and next-phase scope |

Ignored artifacts: runtime credentials and existing local PostgreSQL data. Temporary
smoke scripts were under `/tmp`. `src/`, `supabase/`, historical `drizzle/schema.ts`
and `drizzle/migrations/`, original new-chain SQL `0000`/`0001` and their snapshots
are unchanged. No application feature files were edited.

## Exact validation results

Environment: Bun 1.4.4, Node 24.12.0, existing PostgreSQL 18.6 private cluster.
All database commands targeted only 127.0.0.1:55432 / cape_clergy_vault_dev.

| Command/check | Result |
| --- | --- |
| `bun install --frozen-lockfile --offline --ignore-scripts` with temporary writable cache | Passed, checked 902 installs across 992 packages, no changes |
| `bun run db:auth:generate` | Passed using pinned official CLI, four auth tables; SHA-256 check confirms byte-identical regeneration |
| `bun run db:generate` after implementation | Passed, 14 tables, no schema changes |
| `bun run db:check` | Passed journal/snapshot checks |
| `bun run db:migrate` | Applied additive 0002/0003; repeated successfully, no duplicate ledger entries |
| `bun run db:runtime:setup` repeated after final grants | Passed twice; retained credentials and reapplied explicit grants transactionally |
| `bun run db:test:unit` | 3 tests passed, 0 failed |
| `bun run db:test` | 3 tests passed (parent plus 2 subtests), 0 failed |
| `bun run db:test:auth` after final grants | 10 tests passed (parent plus 9 subtests), 0 failed; repeated successfully |
| Local ledger/cleanup query | Exactly 4 migration entries; 0 profiles, 0 auth users, 0 verifications after cleanup |
| `bun run typecheck` | Passed, including database/auth/tooling/tests |
| `bun run test` | All 6 existing application test files / 23 tests passed |
| `bun run build` | Passed client, SSR, Node/Nitro and PWA generation |
| Focused ESLint on auth/runtime/context/safety/schema/tests/setup/config | Passed |
| Focused Prettier checks | Passed |
| `git diff --check` | Passed |
| Protected-path `git diff --exit-code` | Passed; active app, Supabase and original/historical migration files unchanged |
| Node production smoke (`node /tmp/cape-phase2b-smoke.mjs`) | GET `/` on loopback 3211 returned 200 with Theological Repository content; `/api/auth/get-session` returned 404; child external fetch disabled; server stopped |
| `git check-ignore` and `stat` | Both env files ignored/0600; private cluster directory 0700 |
| Local cluster shutdown | Project-private cluster stopped gracefully after validation; data retained |

The runtime suite's nine subtests cover all twelve requested security categories:
missing context; pending/rejected/suspended/no/obsolete consent; cross-owner documents
and chat; clergy reviewer-write denial; confidential sharing; actual runtime flags and
DDL/RLS/trigger denial; role switching/ledger/migration denial; all four auth tables'
CRUD plus real password/email/session APIs; commit/rollback/concurrent pool reset;
forged ownership/sender/reviewer/role/approval/timestamp writes; unique keys, generated
FK cascades and application retention FK. Consent withdrawal, live reviewer revocation,
live admin suspension, notification scope and immutable history also pass.

Real Better Auth API test: signup emits a locally captured verification token and no
session; unverified login fails; verification succeeds; password login creates a DB
session; cookie-based getSession succeeds; verified-session transaction boundary sets
the correct identity; anonymous boundary fails; signout invalidates the DB session.
No SMTP or external service was contacted by this test.

Initial negative-test attempts exposed a test-helper issue: queries used the outer
transaction client inside savepoints, allowing expected errors to escape. Corrected
the helper to execute through the savepoint client, then reran successfully. The initial
offline generator also logged missing local schema metadata; isolated its validation
setting while retaining runtime validation. Build notices are existing TanStack
inputValidator deprecation/vite-tsconfig-paths notices; repeat migration notices about
existing ledger objects are expected. A nested Node child-process hash-check attempt hit sandbox EPERM; repeating generation directly with a shell SHA-256 comparison passed. No unresolved test/build/lint failure remains.

## Unresolved issues and recommended Phase 3 scope

No Phase 2B blocker remains. Deliberately unresolved future integration decisions:

1. Wire trusted Better Auth sessions only in the dedicated cutover phase; implement
   atomic pending-profile/initial-clergy-role provisioning, session revocation and
   account-disable checks before new workflows or endpoints become accessible.
2. Implement verified email delivery, reviewer invitations and fresh mailbox challenge;
   separate role/approval administration and atomically update status/history. Do not
   infer reviewer access from clergy approval or email alone.
3. Adopt reviewed POPIA notice versions and lifecycle/retention/anonymization rules;
   decide Supabase identity mapping explicitly without automatic email matching.
4. Build private storage, per-request authorization/audited signed downloads, review
   transactions and notification filtering, preserving existing offline/PWA guarantees.
5. Design production roles, provisioning, secrets, backups and connection/session trust
   separately; current connectors intentionally refuse production targets. RLS cannot
   make a compromised trusted runtime connection safe.

Phase 2B ends with this database foundation and report. Phase 3 has not been started.

References used for package/generation verification:
[official Better Auth CLI](https://better-auth.com/docs/concepts/cli),
[official Drizzle adapter](https://better-auth.com/docs/adapters/drizzle),
installed pinned package metadata/types/generator implementation and runtime API tests.
