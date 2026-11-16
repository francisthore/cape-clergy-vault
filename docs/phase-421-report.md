# Phase 4.2.1 — Development orchestration and interface redesign

Date: 16 November 2026 (Africa/Johannesburg).

Implemented locally in logical checkpoints. No commit, push, deployment, production
scheduler, persistent-database migration/reset, privileged user provisioning, live
email send or external PDF transfer was performed.

## 1. Development launcher

The supplied `scripts/cape-dev-all.sh` and existing package edit were present at
start. The package command pointed at the missing `scripts/dev-all.sh`. The supplied
file is preserved; the reviewed implementation now lives at that expected path,
with `scripts/dev-all.mjs` and a restricted read-only database preflight.

- Coordinates only the existing marked project cluster, strict-port localhost web
  server on 3000, scanner, approval/registration notifications and reviewer notifications.
- Never initializes, migrates, seeds, resets, grants roles, deletes data or repairs
  failed authorization automatically. The project PostgreSQL server is left running
  when web/workers stop.
- Parses separate ignored env files as data and constructs allowlisted child envs.
  Owner/scanner/notification credentials cannot enter the web process. Inherited
  test mode/provider configuration cannot silently turn persistent real mail into capture.
- Requires explicit `--allow-live-email`, `--allow-capture-email` and
  `--allow-bouncer` according to configured providers. Capture acknowledges actual
  persistent queue completion; it is never substituted for Resend.
- Checks required keys, local database role URLs, trusted origin, storage agreement,
  scanner configuration/socket, port conflicts and unsafe Vite env keys. `--check`
  performs configuration/port checks without starting database/workers/providers.
- A group `flock` prevents duplicate launchers; lifetime per-kind locks prevent
  duplicate loops. Session advisory locks on reserved restricted connections prevent
  overlapping one-shot CLI batches. Database leases, payload snapshots, stable IDs,
  bounded retries and scan promotion evidence remain unchanged.
- Per-job failure callbacks preserve existing worker return contracts and retry
  transactions while making CLI cycles fail visibly. Three consecutive failed cycles
  stop the whole group; a successful cycle resets that counter. Empty queues alone
  do not establish provider health.
- SIGINT/SIGTERM permit an active batch to finish for up to 190 seconds; the launcher
  kills remaining process groups after 195 seconds. Interrupted durable leases remain
  recoverable. Child exit stops peers and returns a failure.

Commands, configuration boundaries, queue effects, diagnostics and recovery guidance:
[local-development.md](local-development.md).

## 2. Focused UX audit and design system

The prior attachment UI combined filenames, raw lifecycle states, actions and native
file selection in a dense inline row. It described unclaimed jobs as in progress,
did not distinguish delayed verification, and offered a disabled submission action
without a complete contextual explanation. Account navigation was a list of links,
form controls were small, and page headers/surfaces varied across the active workflow.

The redesign uses the existing Tailwind/Radix infrastructure, without another UI
framework or new external service:

- Warm neutral page and card surfaces; restrained diocesan burgundy, readable muted
  text and darker gold accents. The authentic crest and existing generated branding
  assets are retained. Michael's attribution remains intact.
- Shared typography, spacing, radius, surface, status and form-control tokens in
  `src/styles.css`; readable body line-height and 44-pixel standard controls.
- Reusable `PageHeader`, `WorkspaceSection`, `EmptyState`,
  `DocumentAttachmentCard` and `PdfUpload` components.
- Consistent responsive spacing, restrained cards, clear page hierarchy, active
  navigation, a keyboard skip link, visible focus and reduced-motion support.
- A compact homepage, guided registration/login, capability-specific account action
  cards and a clear pending-approval notice.
- Updated submissions/repository discovery, resource detail, registration list/detail,
  reviewer list/detail and email settings. Reviewer PDFs reuse attachment cards and
  receive explicit trusted clean/state evidence from the existing authorized API.

Capability-aware navigation and all authorization predicates remain in place.
Historical Supabase/Lovable references, chat/offline/outbox and PWA data boundaries
remain isolated. The PWA still uses guarded registration and `generateSW`, with no
private response cache or development worker.

## 3. Submission workspace and safe verification projection

The document page now separates resource details, attached documents, submission
readiness, sending to TEFT, and history/author feedback. Desktop uses a contextual
readiness sidebar; mobile stacks the same sections in reading order.

Each attachment shows its file icon/name/size, meaningful status and explanation,
with only relevant actions. Choosing and dropping a PDF share the same exact
20 MiB metadata/content checks. The native input is visually hidden behind an
accessible button; invalid selections produce inline actionable errors. A selected
file displays its name/size before upload. Upload percentage represents only byte
transfer; after 100% the UI explicitly waits for server saving. Security verification
has no invented percentage or queued spinner. Existing attachments expose a modest
“Add another PDF” action. Exclusion and final submission use focus-managed confirmation
dialogs; exclusion explains retained private history rather than permanent deletion.

`0036_owner_verification_status.sql` adds one STABLE, fixed-search-path SECURITY
DEFINER function, `app.owner_document_verification(uuid)`. It checks live account
eligibility and exact submission ownership before returning a fixed derived status;
unauthorized/unknown IDs return NULL. PUBLIC cannot execute it. Runtime receives only
that function grant, never scanner job/event/budget table access. No business state,
worker lease, audit evidence or privileged-user grant is changed by this migration.

The owner detail API includes only `verification_status` alongside its existing
attachment projection. Internal provider IDs, leases, keys, errors and worker data
are never exposed. The interpretation is:

| Derived state            | User-facing state                                     | Evidence                                                                                                                 |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `waiting`                | Awaiting verification                                 | Quarantined/scanning document with queued work; Bouncer pending remains waiting, including during submission/poll leases |
| `checking`               | Being checked                                         | A live ClamAV scan lease, or Bouncer's reported scanning state                                                           |
| `delayed`                | Taking longer than expected                           | A recorded retry/error, expired/missing active lease, or more than ten minutes since attachment creation                 |
| `ready`                  | Ready for submission                                  | Existing `app.document_is_clean` evidence plus available document state                                                  |
| `unsuccessful`           | Verification unsuccessful                             | Failed, infected, held/exhausted/cancelled, legacy/unverifiable evidence                                                 |
| `uploading` / `excluded` | Upload not yet complete / Excluded from this revision | Existing document state/exclusion                                                                                        |

The ten-minute threshold describes delay, never progress or permission. Backend
clean evidence alone permits the ready/download presentation. The existing independent
server submission and private-streaming authorization/audit gates remain authoritative.

The readiness checklist accounts for saved meaningful details, required attachments
and verification of every included PDF. Sending is explained when unavailable,
including editing, selected/unuploaded files, upload in progress and access failures.
Ideas correctly require no PDF. Description readiness normalizes whitespace in line
with the existing SQL transition boundary.

Read-only polling runs every ten seconds only while verification/upload completion
is outstanding; hidden tabs make no polling requests. Focus/visibility restoration
rechecks live access. Once work is complete, periodic detail polling stops. Updates
preserve selected files and mounted editor inputs. The editor retains its starting
version, so a background change cannot silently authorize overwriting another edit.
Access revocation clears private content. Transient failures preserve input while
disabling actions/download links until a successful authorization refresh. Opening
or refreshing a page never claims work or starts a scan.

## 4. Verification

All integration checks use the existing sanitized source-snapshot harness at the
separate local PostgreSQL test endpoint 55433. It creates and verifies whole disposable
clusters, applies migrations only there and disposes them as units. It does not stop,
reset or migrate the persistent project cluster at 55432. Provider credentials are
absent from the test environment; Bouncer uses injected responses; mail is captured;
browser and server external fetches are blocked. Immutable history triggers are never
bypassed and no history rows are deleted for cleanup.

| Check                                      | Result                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run test`                             | 63 passed across 14 files                                                                                                                              |
| `bun run test:dev`                         | 6 passed: provider opt-ins/env separation, IPv4/IPv6 port conflicts, cycle failures/recovery, duplicate loops, group startup/shutdown and peer failure |
| `bun run typecheck`                        | Passed                                                                                                                                                 |
| `bun run test:bouncer`                     | 8 passed, injected provider responses only                                                                                                             |
| `bun run test:scanner`                     | 14 passed; 1 installed-daemon test skipped (no local ClamAV daemon)                                                                                    |
| Isolated scanner/database security suite   | 24 passed                                                                                                                                              |
| Isolated registration/notification suite   | 13 passed                                                                                                                                              |
| Isolated Phase 4.2.1 projection/lock suite | 6 passed                                                                                                                                               |
| Final production build and browser pass    | Isolated build and final local production build passed; 20 browser scenarios passed                                                                    |
| Offline Drizzle migration check            | Passed                                                                                                                                                 |
| Bash/Node syntax and `git diff --check`    | Passed                                                                                                                                                 |

The final complete browser pass passed all 20 scenarios across 320, 390, 768 and
1440-pixel viewports, with touch enabled on mobile/tablet. It covered real file chooser
interaction, invalid-file zero-request behavior, duplicate upload clicks, unsaved
selection/editor preservation, read-only scan polling, all requested verification
states, submission eligibility, guarded private downloads, review/author-note isolation,
capability navigation, captured registration/approval mail and confirmation focus.
Axe WCAG A/AA/2.1 AA and overflow checks ran on the exercised states. The final pass
also covered exact-limit selection, submissions/repository/reviewer/settings accessibility
and synthetic screenshots. Mobile/tablet screenshots were visually inspected. That
inspection prompted a neutral saved-upload notice, avoiding stale awaiting-verification
copy after the trusted status changes.

Local evidence: `.local/phase421-suite.log`, `.local/phase421-build.log`, `.local/phase42-results/build.log`,
`bouncer-database.log`, `integration-browser.log`, `browser-report.json` and
`browser-results/`. These remain ignored; screenshots/captures contain only disposable
fixture data and are not published.

## 5. Outstanding prerequisites and limits

- **Persistent migration remains unapplied.** Review and deliberately apply migration
  `0036` using the guarded existing migration procedure before using this version with
  the persistent database. The launcher fails preflight rather than migrating or
  draining queues against an incompatible schema. Private env files are unchanged.
- The actual persistent development group was not started, because doing so can drain
  real mail/PDF queues. Startup/shutdown use disposable command stubs; real restricted
  connection, scan and notification behavior is checked independently in disposable
  PostgreSQL. Real provider delivery/transfer and installed-daemon acceptance were
  intentionally not performed.
- Existing build deprecation warnings and aborted-request logs during browser navigation
  remain; they are not evidence of email delivery or scan success.
- Physical iOS/Android, Safari/Firefox, actual assistive technologies and human visual/
  mobile acceptance remain necessary. Chromium touch emulation and axe are bounded
  automated checks. Existing external Google Fonts still needs its prior release review.
- All documented privacy/retention, transfer authority, scanning/quarantine operations,
  infrastructure isolation/roles, shared rate limiting, monitoring, worker scheduling,
  deliverability, backups/restore/key custody, quotas/capacity and browser/accessibility
  release prerequisites remain. No unrestricted confidential readiness is claimed.

No chat migration, Google OAuth, production scheduling/deployment or unrelated
application/database change is included.
