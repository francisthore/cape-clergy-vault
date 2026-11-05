# Cape Clergy Vault

A theological repository for clergy of the Anglican Diocese of Cape Town, with
private submissions, review and TEFT conversations. Michael conceptualised and
originally developed the application with [Lovable](https://lovable.dev). This fork
preserves those origins while independently reengineering the application for
self-hosted operation. This is pre-launch software, not a production migration.

The [original editor](https://lovable.dev/projects/219ef20a-7e74-4f29-8092-503e10671dab)
and [historical preview](https://cape-clergy-vault.lovable.app) are attribution
references, not dependencies of the new authentication flow.

## Current phase: 3A

Better Auth **1.7.16**, TanStack Start, PostgreSQL and Drizzle provide registration,
email verification, cookie sessions, login/logout, account status and password reset.
New clergy profiles are pending with only the clergy role. Verification never
approves an account. Legacy repository/reviewer/chat/offline routes are isolated
until their later migration; their Supabase source and packages remain as reference.
The self-hosted public/account flow does not require Supabase or Lovable.

The displayed privacy wording is a **local draft with legal approval outstanding**.
This implementation is locally reviewable, not a claim of production readiness.
See the [complete Phase 3A report](docs/phase-3a-report.md),
[database guide](docs/database.md) and historical
[Phase 2A](docs/phase-2a-report.md)/[Phase 2B](docs/phase-2b-report.md) reports.

## Local development

Use Node 24.12+, Bun and installed PostgreSQL binaries. Only the guarded private
project cluster is supported. Never apply the historical `drizzle/migrations` SQL.

```sh
bun install --frozen-lockfile
bun run db:local:start     # db:local:init only for a new setup
bun run db:migrate
bun run db:runtime:setup
# Put a random 32+ character secret and trusted localhost origin in ignored
# .env.auth.local, following .env.example. Never use VITE_ for auth/email secrets.
bun --env-file=.env.db.runtime.local --env-file=.env.auth.local run dev
```

Open `/auth?view=register`. Default email delivery writes private captures to
`.local/email/*.json` (directory 0700, files 0600); open a captured link locally.
Do not upload captures, log their links or enter real confidential data.
The server needs only the restricted runtime URL, never the migration-owner URL.

```sh
bun run typecheck
bun run test
bun run db:test:unit
bun run db:test
bun run db:test:auth
bun run db:test:phase3a
bun run build
bun run db:smoke:phase3a    # starts/stops built Node server and cleans its fixtures
bun run db:local:stop      # retains data
```

To run the Node build manually with captured mail:

```sh
CAPE_LOCAL_EMAIL_CAPTURE=true node --env-file=.env.db.runtime.local --env-file=.env.auth.local .output/server/index.mjs
```

Real Resend delivery is opt-in: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`,
`EMAIL_FROM`, optional `EMAIL_REPLY_TO`, and `EMAIL_DOMAIN_VERIFIED=true` after
confirming the real sender domain. No Diocese sender/domain is assumed.
Normal tests never contact Resend. The capture override is restricted to localhost.

The service worker caches public static assets only, with no navigation/API cache.
Legacy IndexedDB drafts remain on the device; their UI and delivery are deferred
with the private-chat migration. There is no new offline authentication mode.
