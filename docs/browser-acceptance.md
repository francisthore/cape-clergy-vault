# Browser, accessibility and responsive acceptance

The executable suite uses Playwright Test, installed Chromium and `@axe-core/playwright`.
It drives the built Node application with real DOM controls, cookies, file inputs,
dialogs, downloads and captured email. It does not label HTTP-only tests browser E2E.

```sh
bun install --frozen-lockfile
bunx playwright install chromium
bun run db:local:start
bun run db:migrate
bun run db:runtime:setup
bun run db:scanner:setup
bun run db:notifications:setup
bun run build
bun run test:browser
# Focus a viewport while investigating:
bun run test:browser -- --project=desktop
```

`playwright.config.ts` runs sequentially with one worker, at 320×740, 390×844,
768×1024 and 1440×1000. The server binds only loopback port 3220, refuses reuse of
an existing server, uses a separate private `.local/browser-storage`, and receives
only the restricted runtime URL. Owner/scanner credentials stay in controlled local
fixture code, never the web process. Server environment selects captured email and
contains no Resend key. A network guard rejects non-loopback fetch in the server.
No external Supabase/Resend call is needed or allowed. Test email uses example.invalid.

Fixtures create uniquely named disposable accounts in the guarded database. Privileged
preparation uses exact-ID operator functions, not public grants or email matching.
Verification and password-reset links come from private captured mail. Reviewer proof
is issued and delivered by the real encrypted outbox/capture worker; the browser
explicitly accepts it. The fragment is inserted before hydration without printing it.
PDF checks use the explicitly injected TestScanner with actual disposable stored
bytes and the real restricted scanner role. This validates the UI/safety gate, not
real ClamAV detection. No fake scanner option is added to the application environment.

Tests respect the unchanged live sign-in rate limits through bounded login pacing;
review-role switching can reuse legitimate session cookies in memory. No forged actor,
spoofed IP, disabled RLS or public test-only operator endpoint is introduced. Real
logout/session revocation is exercised separately. Serialized fixture cleanup removes
only its own IDs/objects/captured messages and restores synthetic settings/attestations.
Do not run these owner-fixture tests alongside another writer or on production data.

## Journey coverage

Each viewport executes the following browser scenarios:

1. Registration and explicit draft notice acknowledgement; captured email verification;
   login and pending feedback; logout; captured password recovery and new-password login.
2. Unauthorized approver/settings page denial; authorized approval list/details;
   approve, suspend and reject dialogs; suspended sign-in denial; authorized sender
   save and invalid-domain validation feedback.
3. Draft creation/editing; PDF input/upload; announced pending security checks and
   disabled submission; explicit fixture scan; clean submission/My Submissions;
   captured reviewer invitation/acknowledgement/acceptance; exact-revision assignment,
   start/return and long author feedback; amendment/resubmission and deliberate new
   revision assignment; acceptance; author-private-note isolation; repository search/
   category filtering; real authenticated PDF download; confidential-item denial.

The authentication scenario also verifies generic live/readiness HTTP responses from
inside the browser run while the real scanner is unavailable (live 200, degraded 200).
Detailed restricted-role API/concurrency/attack tests remain separate database suites.

## Accessibility and responsive baseline

Axe scans stable rendered states after fonts and finite animations settle, using
WCAG 2 A/AA and WCAG 2.1 A/AA tags. It covers authentication/verification/recovery,
account, approval list/details/dialogs, settings/errors, draft creation/details,
quarantine status, reviewer invitation/workspace/details/decision dialogs, long
feedback, repository and unavailable resource state. All matched violations fail the
scenario; there are no blanket contrast exclusions. Automated focus checks Tab within
open decision dialogs; form filling/selecting and acknowledgement controls exercise
accessible labels/names. Root horizontal overflow fails the responsive assertion.

Animations initially produced transient dialog contrast failures; testing now waits
for their completed rendered state. The 320-pixel run identified a genuine oversized
email-test button; its label now wraps within available width. No broad redesign or
PWA/offline cache change is introduced.

Automated scans do not establish full WCAG conformance. Still required: human keyboard
end-to-end navigation/focus visibility and return-focus review; screen-reader checks
with NVDA/VoiceOver/TalkBack; zoom/reflow and platform font scaling; real iOS/Android
browser/upload/download behavior; touch targets and device orientation; high contrast/
forced-colors and reduced-motion preferences; long translated/realistic non-confidential
content. Only Chromium viewport emulation is claimed here, not physical mobile devices
or WebKit/Firefox acceptance.

## Artifacts and evidence

Traces, videos and screenshots are off; no credential-bearing auth-state file is
written. Playwright result/error context and JSON reports live under ignored `.local/`.
Conventional report/test-results/auth directories are also ignored by Git. These files
can contain disposable account/session material; never enable them with real confidential
data. No screenshots are committed. Capture files remain private and have no HTTP viewer.

The final [Phase 3F report](phase-3f-report.md) records exact executed counts, initial
failures/corrections, final viewport results and remaining manual/infrastructure gaps.
Reference: [Playwright browser installation](https://playwright.dev/docs/browsers) and
[isolated test web server](https://playwright.dev/docs/test-webserver).

## Phase 4 additions

A fourth scenario checks shared mail throttling across browser contexts, forged
forwarding-header resistance, bounded Retry-After and an actually expired DB session
losing account/repository access. Existing readiness assertion now expects scanner
`degraded` with HTTP 200. Four viewports therefore execute 16 tests. Reviewer delivery
fixtures now use actual restricted notification credentials; owner fixtures remain
separate for deliberate exact-ID preparation/cleanup. No worker secret enters web.
See [manual accessibility/device acceptance](manual-accessibility-acceptance.md) for
all still-pending human tasks; axe success is not full WCAG compliance.
