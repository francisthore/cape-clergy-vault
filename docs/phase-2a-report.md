# Phase 2A implementation report

Completed locally on 5 November 2026 (Africa/Johannesburg). Stopped at the PostgreSQL
foundation; no authentication, registration, workflow migration, deployment or push.

## Repository verification

Started on `feat/self-hosted-migration`, tracking
`origin/feat/self-hosted-migration`, with a clean working tree and HEAD `f2172fb`
(`phase 1.0 audit`). No branch switches, commits, fetches, history rewrites or pushes
were performed. The existing Node build configuration was retained.

Reviewed all six historical Supabase SQL migrations `0000`–`0005` and their schema
stub in `drizzle/`. They define profiles/roles, consent, submissions/private storage,
reviewer invitations, audit immutability, private chat and mute policies using
Supabase-specific auth/storage roles and helpers. These were reference material only;
the original SQL, snapshots, journal, schema stub, `supabase/` and `src/` are unchanged.

## Files changed or added

| Files | Change |
| --- | --- |
| `.gitignore`, `.env.example` | Ignore PostgreSQL credentials/data; safe placeholders, existing tracked `.env` untouched. |
| `package.json`, `bun.lock` | Pin existing ORM/Kit versions, move ORM/driver to runtime dependencies; dedicated database commands. No package versions upgraded in the lockfile. |
| `tsconfig.json` | Include database, tooling and Drizzle config in strict typechecking. |
| `drizzle.config.ts` | New schema/migration paths, app namespace filter, offline config without connection credentials. Removes old Lovable migration URL fallback. |
| `database/schema/common.ts`, `index.ts` | Application namespace, timestamp helper and module exports. |
| `database/schema/profiles.ts` | Profiles, pending-by-default account approval, approval events and role grants/revocations. |
| `database/schema/consent.ts` | Versioned POPIA acceptance/withdrawal history, separate repository/chat purposes. |
| `database/schema/submissions.ts` | Submissions, multiple document metadata records and review decisions. |
| `database/schema/chat.ts` | Owner-scoped messages with stable UUIDs and mute preferences. |
| `database/schema/audit.ts` | ID-only audit events with bigint identity. |
| `database/connection.server.ts`, `safety.ts` | Explicit lazy typed connection; URL, server identity, ownership, marker and privilege checks. |
| `database/migrations/0000_application_foundation.sql` | Generated new application schema, enums, tables, checks, FKs, indexes and RLS. |
| `database/migrations/0001_append_only_history.sql` | Custom append-only triggers for audit, consent, approval, review and chat; revoke public schema/function privileges. |
| `database/migrations/meta/{0000_snapshot.json,0001_snapshot.json,_journal.json}` | Independent new migration chain. |
| `database/safety.test.ts`, `integration.test.ts` | Offline safety and real local PostgreSQL integrity tests. |
| `scripts/db/local-postgres.ts`, `manage.ts` | Project-private cluster lifecycle, guarded migration/status operations. |
| `database/auth/README.md` | Better Auth generation boundary and deferred FK plan. |
| `drizzle/README.md` | Historical SQL warning and explanation of migration isolation. |
| `README.md`, `docs/database.md`, this report | Entry points, architecture, local setup, migration procedure, recovery, validation and next phase. |

Ignored local artifacts: `.env.db.local`, `.local/postgres` (cluster, credentials,
marker, log). `.local/postgres-interrupted` preserves the first unprovisioned cluster
from a sandbox socket restriction; it is not running and contains no application
data. Nothing in these paths is staged or committed.

## Schema and security decisions

Ten application tables live in `app`. User identifiers use opaque PostgreSQL text,
compatible with Better Auth's default string IDs. Business objects use UUIDs; chat
IDs are supplied by clients for offline deduplication. Consent/audit identities use
bigint. Application user FKs reference the profile root; the FK to authentication
is deferred until the actual Better Auth-generated user table exists. No fake auth
tables, auth library or registration functionality were introduced.

Consent, approval, review and audit history are separate from mutable current
profile/submission state. Future server transactions must keep projections and
events atomic. Documents contain private storage metadata, never public URLs or
file bytes. Audit events contain IDs/action/outcome rather than confidential content.
FKs do not cascade-delete history. Audit identifiers intentionally have no FKs.

RLS is enabled everywhere with no policies or client grants. This is a deny-by-default
foundation; authorization has not been migrated. The local owner role bypasses RLS
and is strictly for tooling. Real request identity, runtime role, live consent,
reviewer roles, account approval, audited downloads and mailbox challenge policies
must be implemented/tested before wiring workflows to these tables. Owner/superuser
DDL can disable triggers; the future runtime role must not own schema objects.

## Local isolation confirmed

PostgreSQL 18.6 binaries were already installed. The default port 5432 was not
responding; no system service was started or modified. Created a fresh private
cluster under `.local/postgres`, listening only on `127.0.0.1:55432`, with SCRAM
authentication. Created only this cluster's role `cape_clergy_dev` and database
`cape_clergy_vault_dev`. The role owns its database and has no superuser, database
creation, role creation, replication or BYPASSRLS privilege. A database comment
identifies this project/phase. Identity/ownership/endpoint/privileges are verified
before every tooling connection. Provisioning verified the server data directory.

Credentials are random, ignored and permission 0600; cluster directory is 0700.
No production database, Supabase project or other project's database was accessed.
The private cluster is **stopped with data retained**. Restart using
`bun run db:local:start` before database commands.

## Commands and validation

Routine read-only inspection used pwd, git status/log/diff, rg, cat, command -v,
pg_isready, ls and stat. Source edits used local file writes and targeted Prettier.
Primary implementation/validation commands and results:

| Command | Result |
| --- | --- |
| `bun install --lockfile-only --ignore-scripts` with a temporary writable Bun cache | Updated only root dependency declarations in lockfile; existing package resolutions retained. |
| `bun install --frozen-lockfile --lockfile-only --offline --ignore-scripts` with same cache | Passed; manifest/lock consistency confirmed. |
| `bun run db:generate --name=application_foundation` | Generated schema migration and snapshot without DB access. |
| `bun run db:generate --custom --name=append_only_history` | Generated journal entry for custom trigger SQL. |
| `bun run db:generate` after completion | No schema changes. |
| `bun run db:check` | Passed. |
| `bun run db:local:init` | Created dedicated private cluster, role, DB and local env file. |
| `bun run db:migrate` twice | Passed; fresh apply and safe repeat, two ledger entries and ten app tables. |
| `bun run db:status` | Passed all isolation guards and listed ten application tables. |
| `bun run db:test:unit` | 2 tests passed, covering allowed/rejected URL targets and identity/privilege guards. |
| `bun run db:test` | 3 tests passed (parent plus two subtests); real constraints/history/immutability/default RLS checks, fixtures rolled back. |
| `bun run db:local:stop`, `db:local:start`, `db:status`, `db:test`, `db:local:stop` | Restart/recovery lifecycle verified, tests passed again; left stopped. |
| `bun run typecheck` | Passed, including new database/tooling modules. |
| `bun run test` | All 6 existing files / 23 application tests passed. |
| `bun run build` | Passed client, SSR, PWA and Node server build. |
| Local Node production-server smoke test | GET `/` on 127.0.0.1:3211 returned 200 and expected homepage content. External fetch disabled in child process; server stopped afterward. |
| Targeted ESLint and Prettier on all new TypeScript/config files | Passed. Full legacy lint was not used as an acceptance gate. |
| `git diff --check` | Passed. |
| `git diff --exit-code -- src supabase drizzle/schema.ts drizzle/migrations` | Passed; integrations and historical migration artifacts unchanged. |
| `git check-ignore` and stat on local secrets/data | Ignored paths confirmed, credentials 0600 and cluster directory 0700. |

Database tests cover opaque text user IDs and inferred Drizzle inserts/selects,
approval/submission defaults, FK rejection, enum/check rejection, active-role
uniqueness and revoke/regrant, consent acceptance/withdrawal ordering, duplicate
message UUIDs, blank chat rejection, and UPDATE/DELETE/TRUNCATE rejection on all
five immutable tables. RLS catalog flags/no policies and absence of auth/public app
tables are checked. They do not claim authenticated permission coverage. Rollback
retains fixtures only transiently; PostgreSQL sequence values can still advance.

Initial attempts encountered read-only Bun cache, unavailable sandbox DNS and blocked
local socket binding. Retried dependency resolution in a temporary writable cache
and local socket commands with approved execution access. No automatic approval
rejection remains. The interrupted cluster was preserved, not deleted. A PostgreSQL
inet text-format mismatch (`127.0.0.1/32`) caused the guard to reject the first
migration attempt before any schema writes; corrected it to use host(inet) and
retested. Initial un-applied generated drafts were replaced locally before any
migration applied. Node test discovery reported only file-level execution in this
environment, so database scripts execute their Node test-API files directly; the
actual named tests/subtests then execute and report.

PostgreSQL emitted harmless notices about two generated FK names exceeding its
63-byte identifier limit (server truncates them) and existing ledger objects during
the repeat migration. Build emitted existing router inputValidator deprecation and
vite-tsconfig-paths notices. No validation failures remain.

## Unresolved decisions and recommended Phase 2B scope

1. Pin Better Auth version/plugins and confirm separate `auth` namespace adapter
   mapping. Generate its tables; review text ID types, then add the profile-auth FK
   and transactional profile creation. Keep authentication tables framework-generated.
2. Define the restricted runtime role and trusted request identity, then implement
   and integration-test RLS for consent, approvals, live reviewer access, submissions,
   confidential sharing, chat and mute preferences before changing any data source.
3. Decide approval authority, reviewer invitations/fresh mailbox challenges, session
   revocation, consent notice/version source, retention/anonymization and future
   Supabase identity mapping. Preserve the existing guarantees explicitly.
4. Plan private storage and audited short-lived downloads separately. Do not migrate
   live data or switch workflows merely because the new schema exists.

See [database architecture and recovery](database.md) for operational details. Phase
2A ends here; no Phase 2B implementation has begun.
