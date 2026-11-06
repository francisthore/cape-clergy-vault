# PostgreSQL reviewer boundary (Phase 3E)

The [Phase 3E report](phase-3e-report.md) and [reviewer runbook](reviewer-operations.md)
supersede earlier role/content-access statements below. Apply forward migrations
`0020`–`0025`, then `db:runtime:setup`. There are 26 ledger entries, 22 RLS application
tables and four Better Auth tables. Historical migrations remain unchanged.

The original runtime UPDATE(status) and review-decision INSERT privileges are revoked,
including column grants. There is no submission UPDATE or review INSERT RLS policy.
Author functions remain intact; only `decide_review` performs review transitions.
Status, immutable decision/revision feedback, lifecycle evidence, audit and durable
notification intent commit atomically. Runtime cannot change authorship/confidentiality.

New tables: revision-scoped `reviewer_assignments`, mailbox/digest/expiry-bound
`reviewer_invitations`, immutable `reviewer_events`, and separate retryable
`reviewer_notifications` with encrypted invitation delivery envelopes. Runtime has
RLS-limited assignment SELECT and **no privileges** on the other three. Runtime receives
EXECUTE only on `can_review_submission`, invitation inspect/accept, `decide_review`,
owner-safe feedback and minimal reviewer-author projection. Internal/operator/trigger
functions have neither PUBLIC nor runtime EXECUTE. Runtime has no direct grants on
new tables for mutations. Existing append-only review/audit history is retained.

Admin no longer implies reviewer. Confidential material/private notes require an
active exact-current-revision assignment and eligible live reviewer, except ordinary
author access to their own resources. Accepted non-confidential clergy sharing is
preserved. Document RLS follows that parent rule and `record_document_access` independently
rechecks it before mandatory download audits. System-admin profile/role/audit reads
remain explicit; they do not grant confidential submission/document/history access.
Approver and settings-manager permissions remain independent. Chat migration is excluded;
legacy chat remains isolated and is not a new reviewer endpoint.

Operator commands require interactive confirmation and the guarded owner connection;
web handlers use only restricted runtime credentials and verified Better Auth sessions.
Invitation role activation and assignment administration append separate immutable
evidence with operator/session-derived actors. See the runbook for mailbox proof,
revision confirmation, revocation, encrypted-envelope recovery and notification leases.
The original trusted-server/GUC and in-flight revocation limitations still apply.

## Historical Phase 3D database boundary

## Phase 3D current boundary

The [Phase 3D report](phase-3d-report.md), [settings runbook](application-settings.md)
and [submission lifecycle](submission-lifecycle.md) supersede historical phase-specific
behavior below. Apply additive migrations `0011`–`0019`, then reviewed runtime grants.
There are 20 ledger entries, 18 RLS application tables and four generated auth tables.
No historical SQL/snapshot is rewritten. Drizzle generation reports no schema drift.

New typed tables: `email_settings` (singleton), `email_domains` (protected operator
authorization), `settings_managers` (separate capability), `email_settings_history`
(immutable snapshots), `email_test_attempts` (persistent rate limiting),
`submission_events` (immutable metadata/attachment snapshots). Notifications gain
first-attempt sender/reply-to/recipient snapshots to preserve retry payloads.
Submissions gain `draft`, integer version/revision and submission timestamp;
documents gain an exclusion flag without deleting historical metadata/bytes.

Runtime cannot directly insert submissions or update their metadata. Fixed-purpose
`save_draft`, `transition_submission` and `exclude_draft_document` functions derive
ownership from trusted session context, check eligibility and versions, and append
history/audit atomically. Existing status-only reviewer grants are retained but
policies deny self-review and draft review. Reviewer notes are now readable only
by eligible reviewers of another author's item; authors receive separate lifecycle
events, never private notes. No reviewer onboarding/decision API was added.

Submission SELECT additionally requires verified identity; existing current-consent,
approval, ownership/confidentiality/reviewer checks remain. Repository SQL always
adds accepted/non-confidential predicates before counts/pagination, including for
reviewers. Settings permission implies no reviewer/approver/document permission.
New definer helpers have fixed search paths, qualified names and no PUBLIC execute.
Internal snapshot/trigger/operator functions have no runtime EXECUTE.

The web app uses only `CAPE_RUNTIME_DATABASE_URL`. The existing outbox worker and
operator tools remain guarded local-owner tooling; no web handler imports their
owner connection. Restore matching DB/private-volume backups, rerun reviewed grants
and inventory before resuming writers. Settings recovery and credential backup are
covered in the settings runbook. Never edit the migration ledger or disable immutable
history to recover an ordinary application operation.

The self-hosted public/account application now uses Better Auth on the guarded
local database. Legacy Supabase repository/review/chat/offline routes are isolated.
No production connection, account import, deployment or push has been performed.
See [Phase 3A implementation and local setup](phase-3a-report.md).

## Phase 3C private documents

See [Phase 3C report](phase-3c-report.md) and [storage architecture/recovery](storage.md).
This section supersedes historical references below to future storage or audit work.

- Additive `0008_document_lifecycle.sql` adds pending/available/failed state,
  upload-request UUID uniqueness per parent, available size/checksum constraints,
  and FK-free `audit_events.document_id`. Existing document rows remain pending;
  no production or Supabase data is imported. Twelve app/four auth tables remain;
  the ledger now has eleven entries.
- `0009_document_security.sql` tightens document RLS, adds a verified-email/current
  repository consent predicate and constrained finalize, fail and document-audit
  functions. `0010_document_object_keys.sql` separates object keys from document
  IDs using validated independent UUIDv4 keys; it is a forward refinement, with no
  applied migration rewritten. Previous SQL/snapshots remain unchanged.
- Runtime reserves only zero-size pending rows for its own draft document
  parents. No direct document UPDATE/DELETE is granted. `finalize_document` locks
  the parent, rechecks permission/editability, and atomically publishes accurate
  metadata. `fail_document` can fail only an authenticated owner's pending row,
  even after approval/consent changes; available rows are never demoted on retry.
- Metadata follows submission RLS: approved/verified/current-consent owners,
  authorized live reviewer/admins, or accepted non-confidential sharing. Pending
  and failed metadata is owner-only. Approvers gain no reviewer access.
- Runtime gains EXECUTE on four fixed-purpose functions only. SECURITY DEFINER
  functions have fixed pg_catalog search paths, qualified objects, validated inputs,
  no dynamic SQL and no PUBLIC execution. Anonymous/inactive denial auditing uses
  a session-derived optional identity and a constrained event append, not general
  privileged inserts. Audit history remains append-only; actor/document/parent/
  correlation IDs carry no file content or filesystem paths.
- Short DB transactions bracket filesystem I/O. Uncertain finalization retains
  files until a confirmed failed state permits deletion. No long upload/download
  transaction or unrestricted owner connection is used in web requests. Private
  storage and PostgreSQL backups must be restored as a matching pair.
- `db:test:phase3c` runs with real restricted runtime and disposable fixtures;
  `db:smoke:phase3c` exercises the built Node routes. `storage:inventory --verify`
  is guarded owner-only read-only maintenance, never a destructive cleanup job.

## Phase 3B approval administration

See [Phase 3B implementation report](phase-3b-report.md) for the operator runbook,
full file inventory, results and limitations. The sections below retain historical
Phase 2B/3A descriptions; this section supersedes statements about the role list,
owner-only approval, notification reliability, table/ledger counts and unused context.

- Additive `0006_approval_administration.sql` adds enum role `approver` and two
  RLS-enabled internal tables: `approval_notifications` and `approver_bootstrap`.
  `0007_approval_security.sql` adds fixed-purpose functions, queue triggers, safe
  input checks and the immutable singleton bootstrap marker. There are eight ledger
  entries, twelve application tables and four generated auth tables. `0000`–`0005`
  and historical Supabase migrations are unchanged.
- An approver must have a live, unrevoked `approver` assignment, approved profile
  and verified Better Auth identity. `admin` or `reviewer` alone does not authorize
  registration administration. Existing admin/reviewer content policies are preserved;
  approver is deliberately absent from them. A clergy approval never grants roles.
- Runtime gets only EXECUTE on `is_approver`, `require_approver`,
  `registration_list(text,text,integer)`, `registration_detail(text)` and
  `decide_registration(text,text,text,uuid)`. No new app INSERT/UPDATE/DELETE grants.
  Runtime has no SELECT on the two internal tables and cannot execute bootstrap.
  No general SELECT on auth identities is exposed through the approval HTTP API.
- List/detail SECURITY DEFINER functions require live authorization before reading
  data and return selected personal fields only. Search and 20-row pagination run
  in PostgreSQL. Existing profile/history RLS is not widened for approvers.
- Decisions lock the actor profile/auth/role rows against revocation and lock target
  auth/profile rows against conflicting changes. A transaction updates status and
  appends history, audit and notification intent. UUID retries validate original
  actor/target/action/reason before returning the existing event. Conflicts fail;
  short READ COMMITTED requests retain the documented in-flight revocation limits.
- The owner-only bootstrap function locks an immutable singleton marker table and
  refuses any previous approver grant, even a revoked one. It requires explicit
  exact-ID confirmation and a verified pending/approved clergy identity. It approves,
  grants only approver and records evidence/intent atomically. No migration or server
  startup invokes it. The interactive guarded CLI is the only operator entry point.
- Verification/profile-insert triggers queue one registration receipt only once both
  prerequisites exist. Status-change emails are durable intents in the decision
  transaction. An operator-only outbox worker claims rows with SKIP LOCKED, commits
  a five-minute lease, sends outside a transaction, then records result or backoff.
  It uses the existing EmailService with per-outbox-row provider keys, eight attempts
  and at most one-hour retry delays. It never logs recipient/payload/provider errors.
  This minimal worker uses guarded owner tooling, not a new web-runtime privilege.
  Scheduling, alerting, dedicated production worker permissions and provider ambiguity
  handling remain operational dependencies. Read the report before enabling real mail.
- Root/nested `.env*` files are ignored except `.env.example`; local secrets are
  retained, and removing `.env` from tracking does not remove historical commits.

## Phase 3A changes to the Phase 2B foundation

- `0004_clergy_provisioning.sql` adds narrowly constrained pending-profile
  provisioning and session revocation on suspension. `0005_provisioning_audit_outcome.sql`
  corrects the provisioner's audit outcome to the existing `ok` enum value through
  a forward migration. Applied migrations were not edited.
- Runtime gains EXECUTE on **one** provisioning function, with no additional app
  table writes. It takes identity from the trusted server's transaction context,
  checks identity equality/existence, fixes pending status/clergy role, and atomically
  appends registration approval, repository consent and audit history. Fixed
  `pg_catalog` search_path, no dynamic SQL, no PUBLIC execution. Repeated calls
  cannot overwrite profiles, regrant revoked roles or duplicate history.
- Better Auth signup/account creation is transactional with `transaction: true`.
  Application provisioning occurs in a subsequent scoped transaction. Failure leaves
  a recoverable auth identity, never an approved or usable protected account. Verified
  login shows incomplete onboarding and permits explicit profile completion.
- Existing application SELECT/RLS/history/FK/grants remain intact. Database owner
  URLs remain tooling-only. Runtime sessions explicitly use UTC because Better Auth's
  generated auth timestamps do not carry time zones.
- `createRequestDatabaseBoundary` is wired to live Better Auth cookie sessions.
  Account operations require verified email; future protected operations use
  `withApprovedDatabase` plus purpose-specific consent/RLS. Suspension atomically
  deletes sessions through an owner trigger and login/account status rechecks it.
- The current registration notice maps the preexisting wording to `repository-v1`
  **as a local draft only**, accepted through explicit action. Private-chat consent
  stays separate. Legally reviewed notices and versions remain a release dependency.
- Migration ledger now contains six entries; app/auth table counts remain ten/four.
  Verification replay digests reuse Better Auth's existing verification table; no new
  token/password implementation or application tables were added.

The remaining sections describe the retained Phase 2B foundation; statements about
inactive routes or owner-only profile provisioning below are historical and are
superseded by the explicit Phase 3A changes above.

## Layout and ownership

- `database/schema/`: ten application tables in `app`, exported alongside generated auth tables.
- `database/auth/generated.ts`: official Better Auth 1.7.16 CLI output; four tables in `auth`.
- `database/auth/{options,generate,config}.server.ts`: shared configuration, offline generator,
  and inactive server-only runtime factory. No singleton or route registration.
- `database/connection.server.ts`: guarded migration-owner connection, tooling only.
- `database/runtime.server.ts`: distinct guarded runtime login, pool size two.
- `database/context.server.ts`: future verified-session transaction boundary, unused by routes.
- `database/safety.ts`: fixed local URL, actual server/database/user/owner/marker and privilege guards.
- `database/migrations/`: independent versioned chain; never reads historical `drizzle/` SQL.
- `database/runtime-grants.sql`, `scripts/db/runtime-setup.ts`: explicit grants and guarded role provisioning.

Drizzle ORM **0.45.4**, Kit **0.31.11**, Better Auth, its standalone Drizzle adapter
and official `auth` CLI **1.7.16** are pinned. postgres.js is locked by Bun.
The adapter supports `schemaName: "auth"`; no generated schema transformation is needed.
The official generator preserves text keys, unique email/token constraints, timestamp
columns, indexes, relations and account/session cascade deletion. No Google OAuth.

## Identity, authorization and retention

Authentication records belong to Better Auth: `auth.users`, `sessions`, `accounts`,
`verifications`. The runtime role needs CRUD on these tables to perform authentication;
application identity RLS is deliberately **not** installed on auth tables. Better Auth
must look up accounts, verify credentials and establish sessions before app context exists.
Database credentials therefore belong exclusively to the trusted server, never a browser.

All application user, owner, sender, reviewer and actor IDs are **text**.
`app.clergy_profiles.user_id` references `auth.users.id` with **NO ACTION** on delete/update.
Other app FKs continue referencing the profile root without cascading deletion.
Hard deletion of an auth user with a profile fails, preserving critical history.
Disable through application suspension plus future session revocation instead; retention,
anonymization and final deletion require a separately reviewed maintenance procedure.
Audit IDs intentionally have no FKs and cannot be erased by account cascades.

| Application table             | Meaning                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| clergy_profiles               | Contact/parish information; `pending`, `approved`, `rejected`, `suspended`; pending default |
| account_approval_events       | Immutable approval actor/status/reason history                                              |
| role_assignments              | Explicit `clergy`, `reviewer`, `admin` grants and revocations; one active grant per role    |
| popia_consent_events          | Immutable acceptance/withdrawal by notice version and repository/private_chat purpose       |
| submissions                   | Ownership, metadata, confidentiality and current review status                              |
| documents                     | Private object metadata only, no public URLs or bytes                                       |
| review_decisions              | Immutable review outcomes/notes                                                             |
| chat_messages                 | Immutable owner stream; client UUID deduplicates offline sends                              |
| chat_notification_preferences | Per-user/per-owner mute preference                                                          |
| audit_events                  | Immutable ID/action/outcome evidence, no confidential content                               |

Approval never grants a reviewer/admin role. Runtime cannot create profiles, approve
accounts or grant/revoke roles. Such operations remain owner maintenance only in this
phase, including fixtures. No automatic profile hook creates partial or privileged
profiles. Auth users without profiles fail protected-content policies. Future provisioning
must atomically establish the profile/initial clergy role, with separately authorized
approval and reviewer invitation/fresh mailbox challenge procedures. Status projections
and approval/review history must be updated atomically by future server operations.

## Database responsibilities and grants

| Role                 | Responsibility and privileges                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| cape_local_bootstrap | Private cluster administrator, used only for provisioning after checking data_directory                                        |
| cape_clergy_dev      | Database/schema/table/function owner; migrations and maintenance; no superuser/CREATEDB/CREATEROLE/replication/BYPASSRLS flags |
| cape_clergy_runtime  | Separate LOGIN; no elevated flags, role memberships, ownership, database CREATE/TEMP, schema CREATE or ledger access           |

Only this marked private cluster's runtime role is created. An existing unmarked role
or unsafe attributes/memberships/ownership cause refusal; unrelated roles are never altered.
Runtime credentials are random and stored in ignored `.env.db.runtime.local` (0600),
separate from owner `.env.db.local` (0600). Never put either in tracked `.env`, VITE keys,
logs, URLs in documentation, or browser bundles. Runtime has CONNECT and schema USAGE.

`runtime-grants.sql` revokes existing direct app/auth/ledger grants before regranting:
auth CRUD; app SELECT subject to RLS; selected inserts; UPDATE(status) for submissions;
UPDATE(muted) for preferences; consent/audit identity-sequence USAGE; execution of six
specific authorization helpers. Immutable history inserts exclude caller timestamps.
There is no app DELETE/TRUNCATE, profile UPDATE, role mutation, approval INSERT, schema
modification, role switching, function creation or migration privilege. No automatic runtime grants
are installed; default PUBLIC function execution for this project owner is revoked.
Future objects need reviewed grants. Auth TRUNCATE is also denied.

All objects remain owned by the migration owner. SECURITY DEFINER authorization helpers
use fixed `pg_catalog` search_path, schema-qualified objects and no dynamic SQL. PUBLIC
execution is revoked. They inspect live profiles, roles and consent without recursive RLS.
Their owner bypasses RLS intentionally; runtime cannot alter helpers or owner tables.
RLS is enabled on all ten app tables, with no FORCE RLS because these helpers require
owner access. Owner/cluster administrators remain trusted and can alter policies/triggers.

## RLS rules

Missing/empty `cape.user_id` denies all application rows and inserts. The following
narrow onboarding exceptions do not expose protected repository/chat content: a user
can read their own profile/consent history before approval, and pending/approved users
can append their own consent for the current notice. Rejected/suspended users cannot
append consent. No user can change their own approval or roles through runtime.

| Table                          | SELECT                                                                                         | Writes allowed to runtime                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| profiles                       | Own profile; approved admin sees all                                                           | None                                                                         |
| approval history / role grants | Approved own user or approved admin                                                            | None                                                                         |
| consent history                | Own history                                                                                    | Own current-notice acceptance/withdrawal, pending or approved                |
| submissions                    | Verified/approved + repository consent: own, live reviewer/admin, or accepted non-confidential | Scoped draft/lifecycle functions; live non-author reviewer status updates    |
| documents                      | Parent submission must be readable                                                             | Verified/approved/consented owner, draft parent, independent opaque UUID key |
| review history                 | Verified/approved/consented live reviewer/admin of another author’s submission                 | Eligible non-author live reviewer/admin; no draft decisions                  |
| chat                           | Approved/current-chat-consented self or reviewer/admin; owner also approved and consented      | Same rules, sender must be current user; no edit/delete                      |
| mute preferences               | Own preference and authorized conversation                                                     | Same scoped INSERT/UPDATE(muted); explicit USING and WITH CHECK              |
| audit                          | Approved live admin                                                                            | Approved actor appends only with their own actor ID; no mutations            |

Submission review updates also have separate USING and WITH CHECK policies and a
column-level grant preventing ownership/title/confidentiality rewrites. Reviewer roles
are read live; revocation/suspension and consent withdrawal take effect on subsequent
statements under normal READ COMMITTED isolation. Long-running transactions/snapshots
can delay revocation visibility: keep request transactions short; no absolute instant
revocation guarantee is claimed.

Latest consent is ordered by created_at then identity ID. It must be accepted **and**
match the migration-maintained current version (`repository-v1`, `private-chat-v1`).
The latest obsolete/withdrawn event denies access rather than finding an older acceptance.
These versions are local foundation values, not a mapping of production notice versions.
Before cutover, adopt legally reviewed notice text/version values through new migrations.
A reviewer cannot see a conversation whose owner withdraws chat consent. Future push
recipient filtering must also use live roles, consent and mute preferences.

## Trusted server context and limits

`createRequestDatabaseBoundary` takes a server session verifier and request headers,
not an ID or role from request JSON. Future wiring must pass Better Auth `api.getSession`
with trusted incoming headers and perform current account/session-disable checks.
The verifier runs before opening a transaction. `set_config('cape.user_id', id, true)`
sets identity transaction-locally; every query must use the supplied transaction client.
Commit and rollback restore the connection; tests cover concurrent pool reuse. Never use
persistent SET/session-level identity or execute application queries outside the boundary.
Authorization roles and notice versions are read from DB, never browser or GUC role claims.

**Custom settings alone are not a trusted identity.** The runtime login can set arbitrary
custom GUCs and has full auth-table CRUD by design. RLS cannot protect against malicious
code, SQL injection, stolen runtime credentials, or an untrusted session-verifier callback.
The wrapper is an unused preparatory boundary, not production-ready authentication or an
HTTP integration. Only tests inject fixture identities directly; live tests also exercise
the wrapper with a genuine Better Auth verified session cookie. No public handler exists.

Append-only triggers block UPDATE/DELETE/TRUNCATE of consent, approval, review, chat and
audit history, including when run as owner. Runtime lacks those grants as an additional
layer. This protects existing records, not the truth of newly appended audit actions.
Runtime can append self-attributed events and cannot attest a real download occurred.
Audited downloads/private storage/reviewer mailbox challenges/session revocation and
atomic review/projection updates remain future server work. Existing Supabase enforcement
continues unchanged. Database tests do not claim storage or UI authorization coverage.

## Local setup and validation

Requirements: Node 24.12+, Bun, PostgreSQL binaries (tested PostgreSQL 18.6). No Docker,
sudo, package installation or system service commands. `CAPE_PG_BIN` may select an
installed binary directory. Scripts never attach to an arbitrary existing cluster.

```sh
bun install --frozen-lockfile
bun run db:local:init       # new setup only; refuses existing data/env
# Existing Phase 2A setup: use db:local:start instead of init.
bun run db:migrate
bun run db:runtime:setup    # creates/verifies project role, then applies explicit grants
bun run db:status
bun run db:test:unit
bun run db:test             # owner-only integrity/immutability checks
bun run db:test:auth        # actual runtime login; owner only seeds/cleans fixture data
bun run db:local:stop       # retains data
```

Dedicated target: `127.0.0.1:55432`, `cape_clergy_vault_dev`; owner `cape_clergy_dev`;
comment `cape-clergy-vault:phase-2a:local-only` (retained deliberately).
Private data directory `.local/postgres/data`, marker/bootstrap password/log under
ignored `.local/postgres` (0700). Runtime URL must use exactly `cape_clergy_runtime`.
Generic DATABASE_URL/LOVABLE_DB_MIGRATION_URL are ignored. Query parameters, hashes,
remote hosts, wrong ports/databases/users and missing passwords are rejected before
connecting; actual identity, marker, ownership and flags are checked afterward.
Runtime additionally rejects memberships, ownership, CREATE/TEMP. These guards prevent
accidental access; they cannot resist a malicious local owner forging the marker.

Integrity tests use rollback fixtures and verify four ledger entries, ten RLS app
tables, four auth tables, FKs, enums/checks, uniqueness and all immutable triggers.
Runtime tests create unique committed synthetic fixtures so separate runtime connections
can see them. Owner cleanup briefly disables only history-table user triggers, deletes
only known fixture IDs, and reenables in one atomic table-locking transaction. Run only
in the isolated DB with no concurrent writers. Cleanup failure rolls back trigger changes;
inspect and clean fixture IDs manually before retrying. Sequences can advance on rollback.
Runtime never disables triggers. Tests are executed directly with Node's test API.

## Migration, rollback and recovery

```sh
bun run db:auth:generate                    # only when auth configuration changes; offline
bun run db:generate --name=describe_change  # offline schema SQL/snapshot generation
bun run db:generate --custom --name=policy_change # functions/policies/triggers
bun run db:check
# Review SQL and diff; no drops, implicit backfill or auth direct migrations.
bun run db:migrate
bun run db:runtime:setup
```

Existing `0000`/`0001` and their snapshots are preserved. `0002` adds generated auth
objects, reviewer enum value and the profile FK; `0003` adds authorization functions
and policies. The fixed ORM migrator applies only this chain to `cape_migrations`.
The root Drizzle config has no dbCredentials; never use Kit push or Better Auth migrate.
Migrations do not run during builds/startup. Roles are separately provisioned because
migration ownership deliberately lacks CREATEROLE. Grants run after migrations and are
reviewable in source. Repeat migration/setup is safe; generation reports no schema drift.
Drizzle snapshots do not track custom SQL policy/function drift; review those separately.

Before applying the FK to a database with existing profiles, explicitly reconcile every
profile with its auth user. There is no automatic email matching/backfill. An orphan
profile causes migration failure and rollback, not silent deletion or fake auth creation.

A failed unapplied migration rolls back transactionally; preserve the error and inspect
the ledger before retrying. Applied migrations are immutable: use corrective forward
migrations. No automatic down/drop/reset is provided. Reviewer enum removal and dropping
auth tables are unsafe after data exists. Revert an application release while retaining
additive schema, or restore a protected local backup into a newly initialized marked
cluster; never rewrite the ledger to simulate rollback.

For valuable local data, stop writers and use matching pg_dump/pg_restore tools with
credentials passed through a child environment (PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD),
not command arguments or logs. Keep dumps under ignored protected `.local/`. For physical
backup, gracefully stop this cluster and copy its complete directory/markers/secrets/env;
restore requires the same PostgreSQL major version. Preserve the current cluster before
restoring. If init is interrupted, stop only the marked cluster, preserve data/env under
ignored timestamped names, then initialize fresh; never delete or reuse unknown data.
Inspect `.local/postgres/server.log` on startup failure. Lost credentials require protected
backup recovery or an explicit password reset confined to this marked cluster. No role
passwords are rotated silently on repeated setup. Runtime setup refuses missing credentials
for an existing role to avoid overwriting an unknown setup.

## Phase 3 preparation

Plan trusted session integration, atomic profile provisioning, verified mail delivery,
reviewer invitation/fresh challenge, approval services and live account/session revocation;
retention/anonymization and Supabase identity mapping; atomic audited review/download and
private storage; consent notice adoption, offline delivery and notifications. Define
production provisioning and secrets independently of these fixed local guards. Only then
review a deliberate auth/workflow cutover. Phase 2B does not start that work.

References: [Better Auth generator](https://better-auth.com/docs/concepts/cli),
[Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle),
[PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html),
[PostgreSQL SET LOCAL](https://www.postgresql.org/docs/current/sql-set.html).

## Phase 3F additive boundary

Migrations `0026`–`0031` add exact-assignment notification eligibility/cancellation,
quarantine job/event tables, legacy demotion and clean-evidence download/submission
gates, a global two-live-scan-lease cap and preserved infection evidence during exclusion. The chain has 32 entries and 24 RLS app
tables. Existing applied migrations are unchanged. Scanner event history is append-only.
`cape_clergy_scanner` is separately provisioned with only claim/finalize EXECUTE;
no direct app/auth table access, ownership, elevated flags or role memberships.
Web runtime cannot read/write scan evidence or finalize a scan, including by forged
actor settings. Repeated runtime/scanner setup preserves protected local credentials.
Read [scanning](document-scanning.md) and [operations](operations-monitoring.md).
