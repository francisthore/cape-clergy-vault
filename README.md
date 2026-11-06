# Cape Clergy Vault

A theological repository for clergy of the Anglican Diocese of Cape Town, with
private submissions, review and TEFT conversations. Michael conceptualised and
originally developed the application with [Lovable](https://lovable.dev). This fork
preserves those origins while independently reengineering the application for
self-hosted operation. This is pre-launch software, not a production migration.

The [original editor](https://lovable.dev/projects/219ef20a-7e74-4f29-8092-503e10671dab)
and [historical preview](https://cape-clergy-vault.lovable.app) are attribution
references, not dependencies of the new authentication flow.

## Current phase: 3D

Better Auth **1.7.16**, TanStack Start, PostgreSQL and Drizzle provide registration,
email verification, cookie sessions, login/logout, account status and password reset.
New clergy profiles are pending with only the clergy role. Verification never
approves an account. Legacy reviewer/chat/offline routes are isolated
until their later migration; their Supabase source and packages remain as reference.
The self-hosted public/account, registration administration and new document flows do not require Supabase or Lovable.

Verified, approved holders of the separate `approver` role manage clergy registrations
at `/admin/registrations`. Approval, rejection, suspension and reactivation have
transactional immutable history, security audit and durable notification intents.
The approval role grants no theological-review, private-chat or system-admin rights.

Approved, verified clergy with current repository consent create and edit drafts at
`/submissions`, attach private PDFs with progress, and explicitly submit saved work.
Ideas need meaningful text rather than a PDF. Submitted metadata is locked; returned
items begin an audited amendment. `/repository` searches only accepted,
non-confidential resources, with protected details and audited private downloads.
`/documents` now points into the draft workflow; no manual UUID entry is needed.

A separate `settings_manager` capability controls `/admin/settings/email`.
PostgreSQL stores typed sender/reply-to/enabled settings and immutable audit history.
Auth and notification sends resolve settings without restart. Resend credentials
remain in the protected environment (the phase's permitted fallback); encrypted
in-app credential/provider replacement is **not implemented**. Initial sender values
are proposals; domain verification is reported, not independently checked. Live
sending requires explicit operator domain/sender confirmation and server opt-in.
See [application settings](docs/application-settings.md), [submission lifecycle](docs/submission-lifecycle.md),
[storage recovery](docs/storage.md) and the complete [Phase 3D report](docs/phase-3d-report.md).

The displayed privacy wording is a **local draft with legal approval outstanding**.
This implementation is locally reviewable, not a claim of production readiness.
See the [Phase 3B report and operator procedures](docs/phase-3b-report.md),
[Phase 3A report](docs/phase-3a-report.md),
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
bun run db:test:phase3b
bun run db:test:phase3c
bun run db:test:phase3d
bun run build
bun run db:smoke:phase3a    # starts/stops built Node server and cleans its fixtures
bun run db:smoke:phase3b    # admin page/API authorization and approval over HTTP
bun run db:smoke:phase3c
bun run db:smoke:phase3d    # private document upload/download over real HTTP
bun run storage:inventory --verify # read-only consistency and hash check
bun run db:local:stop      # retains data
```

To run the Node build manually with captured mail:

```sh
CAPE_LOCAL_EMAIL_CAPTURE=true node --env-file=.env.db.runtime.local --env-file=.env.auth.local .output/server/index.mjs
```

Real Resend delivery is opt-in: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and
`EMAIL_DOMAIN_VERIFIED=true` remain server configuration. The flag alone proves
nothing; the exact sending domain also needs protected operator authorization.
Sender/display/reply-to/enabled settings now come from PostgreSQL. `EMAIL_FROM` and
`EMAIL_REPLY_TO` remain compatibility defaults only for standalone legacy service
construction; the running app and outbox worker use the database resolver.
Normal tests never contact Resend. The production capture override is localhost-only.
See the [operator and recovery runbook](docs/application-settings.md).

The service worker caches public static assets only, with no navigation/API cache.
Legacy IndexedDB drafts remain on the device; their UI and delivery are deferred
with the private-chat migration. There is no new offline authentication mode.

## Initial clergy approver and queued notifications

After the intended approver registers and verifies her email, a trusted local operator
must independently confirm the person and obtain the exact Better Auth identity ID.
From an interactive terminal, run `bun run db:bootstrap:approver EXACT_ID`, review the
account shown, then type the exact confirmation requested. This one-time procedure
approves that existing clergy identity and grants only `approver`; it creates no
identity, password, reviewer or admin role. No email/name matching grants privilege.
Never run it at build/startup or through HTTP. See the report for prerequisites and
recovery limits. No real approver has been bootstrapped during implementation.

Registration receipts and status notifications now enter a durable database outbox.
Run `bun run db:notifications` separately to deliver a bounded batch, using captured
email by default. This guarded operator command loads the owner URL; the web server
still uses only runtime credentials. **Schedule this command at least once a minute
and monitor its exhausted count before relying on notifications.** No scheduler or
production service was installed. Eight attempts with bounded backoff, crash leases
and stable provider keys support recovery; exactly-once inbox delivery is not claimed.
Keep sender/origin configuration stable while retrying a batch. See the report for
ambiguous-delivery reconciliation and future worker privilege separation.

Only `.env.example` filenames may be tracked. Root and nested `.env*` files are
ignored; use the ignored local files above. The former tracked root `.env` remains
on disk but is removed from the current index. Historical commits still contain it;
removing tracking does not erase history. Private captures, credentials and database
files stay under ignored `.local/` and ignored environment files.

## Phase 3E: assigned theological review

Reviewer onboarding now requires an exact-identity trusted-operator invitation,
one-time mailbox proof and explicit authenticated acceptance. Each resource revision
needs its own revocable assignment; admin/approver/settings roles do not substitute.
`/reviewer` provides server-paginated assignments and version-checked start/accept/
return actions. Authors see intended feedback with revision history, while private
notes remain assignment-protected. Status/history/audit/outbox changes are atomic;
direct runtime review writes are revoked. Private downloads retain mandatory audits.

Apply the forward migrations and runtime grants with the existing guarded local
commands. Read [reviewer operations](docs/reviewer-operations.md) before using:

```sh
bun run db:reviewer:operator invite EXACT_ID
bun run db:reviewer:operator assign EXACT_REVIEWER_ID SUBMISSION_UUID
bun run db:reviewer:notifications
bun run db:test:phase3e:boundary
bun run db:test:phase3e
bun run build
bun run db:smoke:phase3e
```

[Phase 3E implementation/results](docs/phase-3e-report.md) document the exact boundary,
file inventory and known limits. Only disposable local accounts/captured mail were
used. Reviewed privacy/retention, malware quarantine, production roles/infrastructure,
shared abuse limits, monitored workers, backups/restore drills, quotas, live email
verification and browser/mobile/accessibility acceptance remain release prerequisites.
No chat/OAuth/deployment or Phase 3F work is included.

Phase 3F adds private PDF quarantine/ClamAV integration, exact-assignment notification
checks, restricted scan workers, privacy-safe health/operational reports, pending
retention policy previews and Chromium/axe acceptance tests. Local use remains
pre-launch; no deployment or unrestricted confidential readiness is authorized.
See [Phase 3F report](docs/phase-3f-report.md), [scanning](docs/document-scanning.md),
[monitoring](docs/operations-monitoring.md), [privacy/retention](docs/privacy-retention-readiness.md)
and [browser acceptance](docs/browser-acceptance.md).
