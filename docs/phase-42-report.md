# Cape Clergy Vault — Phase 4.2 implementation report

16 November 2026, Africa/Johannesburg. Branch: `feat/self-hosted-migration`.
Implementation is local only. No deployment, VPS changes, live email/scan, paid
service, privileged real-user grant, commit, push or merge was performed. Dr Revd
Michael's attribution and isolated historical Lovable/Supabase interfaces remain.

## 1. Initial findings and root causes

- The initial working tree contained the owner-supplied `public/dct-crest-source.png`
  and deletions of four generated icons. Those changes were preserved: the original
  was retained unchanged and the requested icon replacements were generated from it.
  Phase 4.1B source was already committed; its report and Bouncer implementation
  were inspected and retained.
- The header used unconditional links and an obsolete `.asset.json` URL under
  `/__l5e/`, which the self-hosted application does not serve. The home page used
  the same broken branding reference.
- The PDF input and drop handler were disabled whenever the metadata editor was
  open. Separately, window focus called `load()`, which cleared the entire detail
  view before fetching. Returning from a native picker could therefore detach
  the input before its selection event. Both conditions are corrected and covered.
- Registration reused historical notice text that promised no third-party sharing,
  unconditional deletion and active private chat. The actual workflow uses service
  providers, retains immutable evidence and excludes active private chat.
- Registration decisions already atomically created outcome intents. Delivery was
  intentionally separate from HTTP decisions. There was no approver-alert fanout.
  Missing outcome delivery was **not reproduced as a stuck queue** in this local
  environment; the read-only observations are below. No speculative provider fix
  or uncontrolled replay was introduced.
- Historical database/browser suites still contain trigger-disabling teardown.
  They were not used to erase evidence or reset the preserved database. New
  integration/browser coverage uses whole fresh disposable environments.

## 2. Authentication-aware navigation

`/api/auth/account` derives repository access from `app.document_account_allowed()`
and keeps the independent approver, reviewer and settings-manager checks. The header
uses that live, no-store server response; no browser role names or stored identity
claims authorize links. Guest, pending, approved and combined-capability menus have
no duplicate links. Loading and failed checks show Home plus a safe check message;
they do not briefly show guest links or retain privileged links during a check.

Successful auth mutations invalidate the header immediately. Route changes, window
focus, returning to a visible tab and a 30-second interval recheck live capabilities.
External operator changes become visible on the next such check; this phase adds no
server-push capability stream. Server route/API/RLS enforcement remains immediate
and independent. Account-page capability links also clear on check failure.

A responsive mobile Menu button has expanded/control semantics; navigation uses
TanStack links, keyboard focus styles and accessible names. Logout invalidates the
menu and navigates to sign-in. Protected requests still fail after logout/expiry.

## 3. Proposed Privacy Notice Version 1

The authoritative wording and version are in
[`src/lib/privacy/notice.ts`](../src/lib/privacy/notice.ts). The modal covers the
proposed Diocese/TEFT responsible office, registration/authentication records,
verification/approval, submissions/reviews, confidentiality, private notes, PDF
screening, Bouncer/Resend/hosting/Google Fonts processing, international-transfer
review, access controls, retention/holds/backups, information rights and an explicit
contact placeholder. It distinguishes acknowledgement from blanket consent and
states that private chat is outside the active workflow.

A compact required checkbox and **Privacy Notice (Version 1)** button replace the
expanded notice. The Radix modal provides focus trapping/restoration, Escape/close,
readable sections, description, mobile sizing, internal scrolling and body scroll
locking. Opening it preserves registration input. The synthetic-data-only pre-launch
warning remains visible outside the modal. **The notice is proposed for approval;
no Diocese/legal approval, lawful-basis determination or production policy adoption
is claimed.** Contacts, retention, provider/transfer arrangements and legal wording
remain outstanding in the approval register.

Migration `0035_phase42_workflow.sql` records new acknowledgements as
`repository-v1-proposed-2026-11-16`, rather than attributing revised text to historical
acceptances. New registration/profile completion requires this exact identifier and
`acknowledged: true` on the server. Historical `repository-v1` rows remain unchanged
and locally eligible. Latest-event withdrawal still denies access; legacy-version
withdrawal remains permitted. New acceptance cannot silently use the retired ID.
The reviewer assignment gate recognises both explicit local versions. Private-chat
version gates are unchanged. A production cutover/re-acknowledgement policy still
requires a separately reviewed forward change.

## 4. Notification recipients, triggers and delivery investigation

The existing approval outbox now supports `registration_pending_alert`. The first
new verified/pending registration intent transactionally fans out one minimal alert
per currently verified, approved, unrevoked approver identity. Both verification
and verified-profile-recovery ordering work. Administrator or settings capability
alone is insufficient; no personal recipient or fallback address is hardcoded.

The alert subject is “New clergy registration awaiting review — Cape Clergy Vault”.
It reveals no applicant name, mailbox, parish, reason or resource details and links
to `/admin/registrations`. The dashboard remains the source of truth. Eligibility
and the captured mailbox are rechecked before delivery. Revoked recipients are
cancelled with evidence. Zero recipients appends
`registration.approver_alert_no_recipients`; it does not invent a recipient or defer
a fanout until a later appointment. No migration backfill or historical mass email
occurs. Repeated verification/recovery/retries cannot duplicate fanout.

Outcome decisions continue through the original transaction/function. Approval,
neutral rejection, suspension and reactivation mail use the existing durable worker,
EmailService, dynamic settings, stable snapshots/keys, leases and bounded retries.
No provider I/O was attached to an HTTP decision. Rollback/idempotency/failure tests
confirm that mail does not undo decisions or reveal internal reasons.

Read-only local observation before migration:

- Two `pending` acknowledgements and two `approved` intents were marked complete.
- No queued/retrying/exhausted approval intents were observed.
- Transactional and notification flags and the configured domain authorization
  were enabled. No active notification-worker connection existed at that instant.
- A short-lived disconnected worker may be between cycles; this is not proof that
  supervision exists or is absent. A completed row can reflect capture or provider
  acceptance and is **not proof of Resend receipt or inbox delivery**.
- No real provider request, recipient replay, inbox/bounce inspection or live mail
  acceptance was performed. The reported missing live delivery therefore remains
  unconfirmed; controlled provider/inbox evidence needs separate authorization.

`npm run db:notifications:status` now provides safe aggregate, read-only diagnostics.
[`registration-notifications.md`](registration-notifications.md) documents the
reliable isolated local workflow, decision-to-intent-to-worker diagnosis and existing
production supervision proposal. `bun run db:notifications` / the npm equivalent
can send real configured mail; it was **not run** against the preserved queue. No
scheduler or VPS service was installed/enabled.

## 5. PDF upload and terminology

The saved detail screen keeps the input mounted during a focus refresh. Permission
failure removes protected data. Selection/drop remain usable with the editor open;
a clear instruction explains saving/closing before upload. The initial screen says
to save metadata first. Selection shows filename/readable size, inline feedback,
checking state, an explicit Upload PDF action, progress and upload completion.
Current document status separately shows security screening and clean availability.

The exact limit remains **20 MiB = 20,971,520 bytes**. Oversized, empty and non-PDF
metadata is rejected before upload; bounded local header/trailer reads also reject
renamed non-PDF contents. Invalid files can be replaced. The independent streaming
server's size/format/hash/ownership/consent checks are retained. No scanner or private
streaming authorization was relaxed. Upload success is not scan success; quarantine
has no download link and a direct authenticated download remains unavailable.

The genuine Playwright journey opens the visible native picker, selects while the
editor is open, simulates returning focus, verifies the input remains connected,
uploads one harmless synthetic PDF and asserts exactly one upload even on duplicate
clicks. Invalid selections and oversize drop produce **zero** upload requests. A
mocked asynchronous Bouncer job then clears the exact hash/size; one provider POST
and one poll are asserted. The resource is sent to TEFT, reviewed by an independently
activated/assigned reviewer and downloaded through authenticated private streaming.
Author API output is checked for absence of private reviewer notes.

Existing Bouncer coverage separately verifies v1/v2 larger uploads, persistent IDs,
restart/poll recovery, hashes/sizes/revisions/leases, quota/outage handling and no
repeated chargeable POST during ordinary polling. No live file left local storage.

Clergy wording now uses “Not yet submitted”, “Save and continue later”, “Edit
submission”, “Revise and resubmit”, “Send to TEFT for review” and explicit PDF
security states. Lists, empty states, confirmations, success text and history labels
were updated. The database state machine and immutable versions/transitions remain
unchanged. Registration approval, theological acceptance and security clearance are
still separate processes.

## 6. Branding assets

Canonical unchanged owner-supplied original: `public/dct-crest-source.png`, RGBA
**250 × 343**. This is a genuine supplied raster, not a high-resolution/vector source.
No crest was invented, scraped, redrawn, recoloured or vector-wrapped. Generated
512-pixel output cannot create detail absent from that original.

Reproducible generator: `scripts/branding/generate.mjs` / `npm run branding:generate`.
It uses local Chromium canvas only, with no external images or artwork generation.

| Derivative                    | Dimensions / composition                       |
| ----------------------------- | ---------------------------------------------- |
| `public/dct-crest-header.png` | 140 × 192, transparent, aspect ratio preserved |
| `public/favicon.png`          | 32 × 32, padded white backing                  |
| `public/apple-touch-icon.png` | 180 × 180, padded white backing                |
| `public/app-icon-192.png`     | 192 × 192, padded white backing                |
| `public/app-icon-512.png`     | 512 × 512, padded white backing                |

The reusable Crest component supplies header/hero sizing. Home, header, root metadata
and manifest point to local derivatives. The manifest starts at `/` and no longer
advertises active chat or falsely declares these icons maskable. The sole removed
asset descriptor was `src/assets/logo-diocese-of-cape-town.png.asset.json`, after both
references were replaced. No unrelated public asset was deleted: robots,
`sw-cleanup.js`, manifest and service-worker support remain. Browser tests prove
crest loading and 200 responses for favicon/touch/manifest icons in every viewport.
The production generateSW build revisions changed static assets; the guarded worker
registration, dev/preview exclusions and no-private-cache rules remain intact.

## 7. Files modified

- Navigation/auth: `src/components/SiteHeader.tsx`,
  `src/lib/auth/{client.ts,account-context.ts,account-state.tsx,registration.ts,service.server.ts}`,
  `src/routes/{__root.tsx,account.tsx}`.
- Privacy: `src/components/RegistrationFields.tsx`, `src/lib/privacy/notice.ts`.
- Submission/upload: `src/components/submissions/{SubmissionDetail,SubmissionForm,SubmissionList}.tsx`,
  `src/lib/submissions/{wording.ts,service.server.ts}`,
  `src/lib/documents/{validation.ts,validation-contents.test.ts,service.server.ts}`,
  `src/routes/submissions.new.tsx`.
- Branding: `src/components/branding/Crest.tsx`, `src/routes/index.tsx`, the public
  assets/manifest and removed descriptor listed above, `scripts/branding/generate.mjs`.
- Notifications: `src/lib/email/templates.server.ts`, `src/lib/notifications/worker.server.ts`,
  `scripts/db/notification-status.ts`, `database/migrations/0035_phase42_workflow.sql`,
  its snapshot and migration journal. Applied historical migrations were not edited.
- Tests/tooling: `database/phase42.test.ts`, `browser/phase42-fixtures.ts`,
  `browser/phase42.spec.ts`, `playwright.phase42.config.ts`, `scripts/db/phase42-test.ts`,
  `scripts/db/phase41b-test.ts`, `browser/server.ts`, `database/test-fixture-audit.ts`,
  `scripts/db/{phase3e-audit,phase3f-audit}.ts`, `package.json`.
- Historical test input/label compatibility only:
  `browser/{acceptance,pdf-validation}.spec.ts`, `database/phase{3a,3d,3e}.test.ts`,
  `scripts/db/phase3{a,b,d}-smoke.ts`. Their historical teardown was not invoked.
- Documentation: this report, `registration-notifications.md`,
  `privacy-retention-readiness.md`, `privacy-approval-register.md`,
  `worker-supervision.md`, `submission-lifecycle.md`, `release-readiness.md`.

## 8. Exact executed validation

| Command/check                               | Final observed result                                                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                         | Passed                                                                                                                                                                                      |
| `npm test -- --reporter=dot`                | 51 passed, 13 files, 0 failed                                                                                                                                                               |
| `npm run db:test:unit`                      | 3 passed, 0 failed                                                                                                                                                                          |
| `npm run test:bouncer`                      | 8 passed, 0 failed; mocked provider                                                                                                                                                         |
| `npm run test:scanner`                      | 14 passed, 1 skipped, 0 failed; real clamd socket absent                                                                                                                                    |
| `npm run test:phase42`                      | Passed: production snapshot build, separate fresh clusters, 24 existing Bouncer DB tests, 13 Phase 4.2 DB tests and 16 Chromium browser tests; 0 final failures/skips                       |
| Browser viewports                           | 320 × 740, 390 × 844, 768 × 1024, 1440 × 1000; 4 journeys each, 16 passed in 1.5 minutes                                                                                                    |
| Browser accessibility                       | Automated axe WCAG A/AA checks on tested screens/dialog, keyboard trapping/restoration/Escape/close and horizontal-overflow assertions passed                                               |
| `npm run db:generate`                       | No schema changes remaining                                                                                                                                                                 |
| `npm run db:check`                          | Passed                                                                                                                                                                                      |
| `npm run build`                             | Passed; existing dependency/deprecation notices remain                                                                                                                                      |
| Targeted ESLint                             | All 43 changed code files in final full-lint JSON: 0 errors, 0 warnings                                                                                                                     |
| Full `npm run lint` / final `eslint .` JSON | Fails: 683 errors, 8 warnings, all outside changed code; includes existing legacy and ignored local artifact sources                                                                        |
| `npm run db:migrate`, `npm run db:status`   | New local forward migration applied; guarded target verified, 36 migration hashes now recorded                                                                                              |
| History preservation                        | All 16 pre-existing rows across 10 append-only tables retain identical row digests after migration; no history deletion/trigger bypass                                                      |
| `npm run db:audit:phase3e`                  | Passed: 36 exact hashes, 26 RLS tables, restricted grants, enabled history triggers, no live fixtures, 56 credential-free browser artifacts                                                 |
| `npm run db:audit:phase3f`                  | **Failed** at its historical empty capture/storage assertion: 3 existing artifacts retained. Its preceding DB/grant/trigger/fixture checks passed; it did not reach its final artifact scan |
| Independent final artifact scan             | 56 nonempty browser artifacts; no configured private credentials or Bouncer implementation/API key/endpoint                                                                                 |
| `npm run db:notifications:status`           | Read-only aggregate observation documented above; no mail delivery                                                                                                                          |
| `git diff --check`                          | Passed                                                                                                                                                                                      |

The scanner socket suite initially hit sandbox socket restrictions; its unrestricted
local-mock rerun passed with the single real-daemon skip above. Early isolated browser
iterations exposed test-build configuration, logout synchronization and revoked
fixture-session reuse issues; these were corrected before the final 16/16 run.
No intermediate failed run is represented as successful final evidence.

The normal project cluster was already running. Tests left it running and used an
explicit source snapshot with only its fixed test port changed to 55433; original
55432 safety guards remain unchanged. Explicit source copying excludes private envs,
user storage and captures. Each disposable cluster verifies manifest, database-role
marker and data-directory identity; provider credentials are absent, emails captured
and scan responses mocked. Whole-environment disposal preserves append-only history
throughout each run. The new migration was then applied separately to the guarded
local project database, with private read-only before/after digest evidence. No
real capability grants or mail/scanner jobs ran during migration.

Private ignored evidence: `.local/phase42-results/{build.log,bouncer-database.log,
integration-browser.log,browser-report.json,final-build.log,local-migration.log,
audit-phase3e.log,audit-phase3f.log}`; lint JSON and aggregate diagnostics are under
`.local/`. Existing private captures and environments were preserved.

## 9. Known issues and remaining release/demo gates

- The reported missing live inbox delivery is not explained by a currently stuck
  local queue. Separately authorised controlled Resend/provider/inbox acceptance
  and actual worker scheduling evidence remain required. No existing recipient
  was replayed. A completed database row alone cannot settle that question.
- The old Phase 3F audit assumes globally empty local capture/storage directories
  and stops on three pre-existing artifacts. These were deliberately preserved.
  Its failure is reported, not bypassed; an independently executed artifact scan
  supplies the missing final artifact evidence. Historical Phase 3A–4 suites with
  trigger-disabling cleanup were not rerun; their old reports are historical only.
- Whole-repository lint remains failing outside changed code. Browser/DB coverage
  added here passes; unrelated legacy lint and safe isolation of the remaining
  older suites remain separate work.
- Capability visibility rechecks on focus/route/visibility and every 30 seconds;
  external operator changes have no push transport. Backend authorization is live
  on every protected operation.
- The real Diocese/Information Officer contact, approved notice/lawful bases,
  retention/rights/holds, provider agreements and cross-border/confidential transfer
  authority remain unresolved. Demonstrations must use synthetic accounts/PDFs.
- The supplied crest is modest-resolution. Request a genuine higher-resolution or
  authentic SVG original for larger artwork; generated size is not source detail.
  Google Fonts remains external and needs self-hosting or review before launch.
- Physical Android/iPhone/Safari/Firefox installation, real assistive-technology
  and human mobile/accessibility acceptance remain unexecuted. Chromium emulation
  and axe are not substitutes.
- Existing scanner live-contract/transfer/quota acceptance, actual supervision,
  infrastructure/process isolation, shared-rate-limit capacity, monitoring,
  deliverability, backup/restore/key custody, retention, storage quotas and all
  release-readiness prerequisites remain open as documented. No unrestricted
  confidential readiness or production launch is claimed.

Phase 4.2 stops here. No Phase 3F expansion, chat migration, Google OAuth,
MyChurchIT/Microsoft 365 integration, deployment or paid service was activated.
