# PostgreSQL foundation (Phase 2A)

This is a local, unused foundation. The running application still uses its existing
Supabase clients, server functions, auth, storage and policies. No data is imported.
No production connections, deployments or authentication implementation are included.

## Layout and migration boundaries

- `database/schema/`: modular, strongly typed application tables in PostgreSQL `app`.
- `database/auth/`: reserved for Better Auth-generated tables in a separate `auth`
  namespace; see its README. No handwritten authentication tables.
- `database/connection.server.ts`: explicit lazy postgres.js/Drizzle factory with
  identity validation, one pooled connection and explicit close. Tooling-only;
  application routes do not import it. Building never opens a new database connection.
- `database/safety.ts`: fixed URL allowlist followed by server-side identity checks.
- `database/migrations/`: independent Drizzle journal, snapshots and SQL. `0000`
  creates the schema; `0001` installs history immutability triggers.
- `drizzle/`: unchanged historical Supabase SQL/schema/metadata, reference only.
  The new config and migration runner never read it.
- `scripts/db/`: guarded local cluster lifecycle and migration/status commands.

Drizzle ORM 0.45.4 and postgres.js are runtime dependencies; Drizzle Kit 0.31.11 is
a development tool. Versions are locked in bun.lock. Node 24.12+ runs tooling
TypeScript directly; no new TypeScript runner is needed.

## Identity and schema decisions

Better Auth uses string IDs by default. All application user/actor/owner/reviewer
IDs are PostgreSQL **text**, including the profile primary key. Do not cast IDs to
UUID or infer identity from email. New business entities use UUIDs independently.
The future auth-user FK is deliberately deferred until Better Auth generates the
real table. Existing UUID-shaped Supabase IDs could be preserved as text during a
separately reviewed migration; this phase makes no account mapping decisions.

| Module/table | Purpose and invariants |
| --- | --- |
| profiles / clergy_profiles | Names, title, parish, phone; pending approval by default. No passwords, emails or sessions. |
| profiles / account_approval_events | Append-only approval decisions and actor/reason history. |
| profiles / role_assignments | clergy/admin grants; one live assignment per user/role, revocation timestamp preserves grants. |
| consent / popia_consent_events | Append-only accepted/withdrawn events by user, version and repository/private_chat purpose. Bigint identity breaks timestamp ties. |
| submissions / submissions | Owner, document/idea, metadata, keywords array, confidential flag and existing review statuses. |
| submissions / documents | Multiple private object metadata records per submission; unique storage key, bigint size, optional SHA-256; no file bytes or signed/public URLs. |
| submissions / review_decisions | Append-only reviewer outcome/notes history; separate from current submission status. |
| chat / chat_messages | One owner stream, sender FK, client-assigned UUID for offline deduplication, 1–4000 trimmed characters, immutable messages. |
| chat / chat_notification_preferences | Per-user/per-owner mute, composite primary key. |
| audit / audit_events | Append-only bigint identity, action/outcome, actor/target/submission/correlation IDs; no confidential content or email. |

All FKs use NO ACTION rather than cascading deletion. Audit IDs have no FKs so
future lifecycle operations cannot erase evidence. Consent, approvals, reviews,
chat and audit reject UPDATE/DELETE/TRUNCATE through PostgreSQL triggers. Database
owners/superusers can alter triggers; this is not tamper resistance against an
administrator. A future runtime role must not own tables or have DDL privileges.

Current status fields are projections: future server transactions must append an
approval/review event and update its projection atomically. The schema alone does
not validate role grants, reviewer mailbox control or permitted status transitions.
Future consent evaluation must check the latest event for the **current notice
version and purpose**, ordered by created_at and id; withdrawal must deny access.

RLS is enabled on all ten application tables with **no policies or client grants**.
This is a deny-by-default foundation, not migrated authorization. The local owner
role bypasses RLS as PostgreSQL table owners normally do; it is for migrations and
integrity tests only. Before any workflow migration, implement a separate runtime
role, trusted request identity, live consent/approval/roles, and tested RLS for own
submissions, reviewers, shared accepted non-confidential documents, chat and mute.
Keep audit append-only. Preserve private object storage, short-lived audited download
URLs, reviewer fresh-code verification and immediate revocation enforcement. No
Supabase policy is copied blindly: its auth.uid()/roles/storage dependencies do not
exist here.

## Local setup and isolation

Requirements: Node 24.12+, Bun (locked install), and PostgreSQL server binaries
(initdb, pg_ctl, postgres; tested with 18.6). No Docker or system PostgreSQL service
is required. Install missing binaries yourself using your OS's supported method,
or ask an administrator; these scripts never install packages, use sudo, start a
system service or attach to an existing cluster. Set `CAPE_PG_BIN` to the absolute
binary directory if auto-detection does not find your version. Use the same major
version as the initialized cluster when restarting it.

```sh
bun install --frozen-lockfile
bun run db:local:init       # once: creates a new project-private cluster and starts it
bun run db:status           # proves identity before listing app tables
bun run db:migrate
bun run db:test:unit
bun run db:test
bun run db:local:stop       # graceful stop, retains all data
bun run db:local:start      # subsequent sessions
```

Initialization refuses an existing `.local/postgres` or `.env.db.local`; it never
overwrites them. Data, bootstrap secret, ownership marker and server log live under
ignored `.local/postgres` (0700). Random application credentials live only in ignored
`.env.db.local` (0600). `.env.example` contains placeholders. Existing tracked `.env`
is left unchanged; do not put PostgreSQL secrets in it. Do not use a `VITE_*` key for
database credentials. Restrict access to local backups as they may contain PII.

Dedicated target:

| Property | Required value |
| --- | --- |
| Interface / port | 127.0.0.1:55432 (SCRAM authentication, loopback only) |
| Database | cape_clergy_vault_dev |
| Owner/login role | cape_clergy_dev |
| Role privileges | NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS |
| Database comment | cape-clergy-vault:phase-2a:local-only |
| Application namespace | app |
| Migration ledger | cape_migrations.__drizzle_migrations |

The private cluster has a separate `cape_local_bootstrap` administrator used only
for provisioning. After connecting with the application development role, tools
validate actual database, user, owner, server IP/port, marker and restricted role
flags before migration/testing. Generic DATABASE_URL and LOVABLE_DB_MIGRATION_URL
are ignored. Query-string host overrides, remote hosts, other databases/users,
default port 5432 and missing passwords are rejected before connecting. The marker
is an accident-prevention guard, not protection against a malicious local owner.
If port 55432 is occupied, stop and investigate; do not reuse that listener or
change the allowlist to another project's database. The bootstrap also checks
`data_directory` before creating any role/database.

## Migration workflow

```sh
bun run db:generate --name=describe_change   # offline, no database credentials
bun run db:check                           # offline snapshot/journal validation
# Review generated SQL and snapshots, particularly drops/type changes and RLS.
bun run db:migrate                         # only guarded designated local target
bun run db:test                            # after migrations
```

Use `db:generate --custom --name=...` for triggers/functions that Drizzle snapshots
do not model. Include custom SQL in the same journal; snapshot no-change detection
does not verify trigger drift. Keep applied files immutable; add forward migrations
instead of editing them. Do not use drizzle-kit push, an arbitrary migration path,
Supabase CLI, or psql against historical SQL. Root Drizzle config intentionally has
**no dbCredentials**, so direct Kit migrate/push cannot silently pick up old
credentials. The only provided apply command is the guarded Drizzle ORM migrator.
It wraps unapplied migrations in a transaction and records them in its own ledger.
No migration runs on application startup or build. There is no destructive reset script.

## Validation and recovery

`db:test:unit` checks URL rejection and server identity guards without PostgreSQL.
`db:test` exercises the real database, inferred Drizzle insert/select types, defaults,
FKs/checks/enums, role uniqueness/regrant, consent withdrawal, duplicate message IDs,
all five tables' mutation/truncate protections, RLS flags and absence of policies,
auth tables and public application tables. Fixtures run in rollback transactions;
identity sequence counters can advance even on rollback. The test checks catalog
RLS defaults, not real authenticated permissions (those do not exist yet). Run it
against the dedicated local database after `db:migrate`. Tests use Node's test API
with direct file execution so individual tests execute/report in this environment.

If startup fails, read `.local/postgres/server.log`. Verify installed binary version,
loopback binding permission and port availability. Do not change system services.
If initialization was interrupted before credentials/provisioning completed, stop
only the marked project cluster first if it started. Preserve both the directory
and any env file by moving them to timestamped names under `.local/` (keep secrets
ignored). Then initialize a fresh project cluster and migrate. Never delete or reuse
an unrecognized data directory. If existing data matters, recover it first instead
of reinitializing. `db:local:start` restarts an already initialized cluster; init
intentionally does not attempt partial provisioning against an existing database.

Before schema changes with valuable local data, stop writers and take a `pg_dump`
custom-format backup using the same PostgreSQL major-version tools and only the
validated local URL. Keep credentials out of shell history/process arguments by
loading `.env.db.local` in a local script and supplying PGHOST/PGPORT/PGDATABASE/
PGUSER/PGPASSWORD to pg_dump's child environment; write under ignored `.local/`.
For the most conservative recovery, gracefully stop this private cluster and copy
its entire data directory and local env/marker/secret files to a protected ignored
backup, then restart. Physical copies require the same PostgreSQL major version.

A migration error rolls back its transaction: preserve the error, inspect the SQL
and ledger through the guarded connection, fix an unapplied migration, then retry.
If a change has already been applied, create a corrective forward migration. No
automatic down migration, DROP DATABASE, TRUNCATE reset or deletion is supplied.
For a restore, preserve the current local cluster first, initialize a fresh marked
project cluster, verify its identity, restore only this project's backup there using
the matching pg_restore, and verify migrations/tests. Never restore over another
project or any production database. Reconstruct a lost `.env.db.local` only from a
protected backup or a password reset confined to the marked private cluster; do not
print the bootstrap password into logs.

## Phase 2B decisions

Pin Better Auth and required plugins, validate generated text IDs and separate auth
namespace, generate/review its tables, then add the profile-to-auth FK and transactional
profile provisioning. Decide account approval authority, reviewer invite/challenge
model, consent notice/version source, retention/anonymization and future identity
mapping before exposing any routes. Build and test the runtime-role/RLS boundary
before moving functionality. Private storage/download auditing and auth/session
revocation need explicit designs. No Phase 2B work is implemented here.

References: [Drizzle generation](https://orm.drizzle.team/docs/drizzle-kit-generate),
[Drizzle migrations](https://orm.drizzle.team/docs/migrations),
[Better Auth database/schema generation](https://better-auth.com/docs/concepts/database),
[Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle).
