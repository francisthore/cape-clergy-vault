# Communications, crest-based branding and Privacy Notice Version 1: report

Written for: the Cape Clergy Vault development team, the Diocese Information Officer and the reviewers who will review and merge this work.

## Scope and isolation

- Worktree: `/home/mamba/mts/cape-clergy-vault-comms`
- Branch: `feat/communications-branding-privacy`, now based on `018bcb4` (Codex's committed Phase 4.2.2 work, "Implement Phase 4.2.2 TEFT administration and submission readiness").
- Integration was done after Codex's commit. The worktree was moved onto that commit, and this work was re-applied on top of it.
- Nothing has been committed or pushed on this branch. The main checkout (`feat/self-hosted-migration`) was not edited.
- No database, live worker, live email provider or production system was used. `node_modules` in the worktree is a symlink to the main checkout's dependencies, used read-only.

## A. Transactional email wording

All fifteen notification kinds (`EmailKind`) are covered, matching the brief's list. Codex's Phase 4.2.2 commit adds no further kinds. Recipients, delivery queues, idempotency keys, sender configuration and timing are unchanged.

### Subjects, actions and wording by notification type

| Kind                                     | Subject before                                 | Subject after                                   | Action before              | Action after                   |
| ---------------------------------------- | ---------------------------------------------- | ----------------------------------------------- | -------------------------- | ------------------------------ |
| `verification`                           | Verify your email address                      | Verify your email address (unchanged)           | Verify email               | Verify email address           |
| `pending` (registration received)        | Registration received                          | Your clergy registration has been received      | View account status        | View account status            |
| `registration_pending_alert` (approvers) | New clergy registration awaiting review        | A clergy registration is awaiting review        | Manage registrations       | Open registrations             |
| `approved`                               | Account approved                               | Your clergy registration has been approved      | Sign in                    | Open the TEFT Repository       |
| `rejected`                               | Registration update                            | An update on your clergy registration           | View account status        | View account status            |
| `suspended`                              | Account suspended                              | Your account access has been suspended          | View account status        | View account status            |
| `reactivated`                            | Account reactivated                            | Your account access has been restored           | Sign in                    | Sign in                        |
| `reset`                                  | Reset your password                            | Reset your Cape Clergy Vault password           | Reset password             | Choose a new password          |
| `reviewer_invitation`                    | Reviewer invitation                            | Reviewer invitation for theological review      | Review invitation          | Open reviewer invitation       |
| `review_assigned`                        | Review assignment                              | A resource has been assigned to you for review  | Open reviewer workspace    | Open reviewer workspace        |
| `submission_received` (author)           | Your resource has been received                | Your resource has been received by TEFT         | View submission            | View my submission             |
| `submission_intake` (TEFT staff)         | New theological submission awaiting assignment | A theological submission is awaiting assignment | Open TEFT submission inbox | Open the TEFT submission inbox |
| `submission_accepted`                    | Submission accepted                            | Your submission has been accepted               | View submission            | View submission                |
| `submission_returned`                    | Submission returned for amendment              | An update on your theological submission        | View feedback              | View feedback                  |
| `test`                                   | Email configuration test                       | Email configuration test                        | View account               | Open my account                |

Subject wording was chosen with the existing tests and helpers in mind. Verification keeps its "Verify" prefix, and the reviewer invitation keeps the phrase "reviewer invitation". Browser fixtures and database tests select captured mail by those strings. Rejection, approval and the submission-received body are checked by existing tests too, and they still match.

### Substantive content changes

- Removed robotic phrases from ordinary user emails: "The dashboard is the source of truth", "your current authorized assignments", and "provider acceptance does not confirm recipient delivery" (rewritten as a plain statement).
- Assignment, receipt and decision are kept distinct: `submission_received` says the resource is awaiting the next review stage; `review_assigned` says a resource has been assigned; `submission_accepted` and `submission_returned` are decisions.
- The rejection and suspension emails are neutral. They state the outcome and direct the reader to sign in or contact the Diocese. They give no internal reason, decision note or reviewer content.
- Expiry wording was checked against the implementation. Verification and password-reset links expire one hour after they are sent (Better Auth `expiresIn: 3600`, and the one-hour reset default). Reviewer invitations expire one hour after issue (database expiry check). The reset email also states that existing sign-ins end when the password changes, which matches `revokeSessionsOnPasswordReset: true`. The verification email says a new link can be requested from the sign-in page, matching the existing `resend` view.
- Subjects and bodies contain no submission titles, descriptions, reviewer notes, tokens or other confidential details. The reviewer invitation link is the only sensitive item. The body says to keep it private, and the one-hour expiry is stated.
- Closings: ordinary correspondence uses "Kind regards, The TEFT Team, Anglican Diocese of Cape Town". Security and account-status emails (verification, reset, suspension, test) use a plain "Cape Clergy Vault" closing, as the brief suggested.
- The subject suffix " — Cape Clergy Vault" was removed, because the sender name already identifies the application and the brief's examples use plain subjects. Two database assertions on exact subjects were updated to match (see Files changed).

## B. Email presentation

One reusable layout (`src/lib/email/templates.server.ts`) renders every kind.

- Structure: crest and "Cape Clergy Vault / Anglican Diocese of Cape Town" header, a thin crest-gold rule, a heading, short paragraphs, one prominent action button, an accessible fallback URL, a closing and a discreet footer.
- Presentation: table-based responsive layout, inline CSS only, a 600px maximum width, and one small `@media` block to adjust padding on phones. No external CSS, fonts, JavaScript, tracking pixels or background images.
- Crest: `dct-crest-source.png` (the canonical source) is displayed at 64 × 88 px, aspect ratio preserved, with no recolouring or redrawing. It is loaded from the trusted application origin that the email service already validates (`new URL(url).origin`). Alt text is "Diocese of Cape Town crest". If images are blocked, the wordmark and all text remain understandable.
- Text and HTML are generated from the same specification, so they are semantically equivalent. Every interpolated value, including the link, is HTML-escaped. The text version always contains the full URL.
- Preheader text is included, hidden by inline styles.

Rendered checks (Playwright, Chromium, local files only; nothing sent):

- Approved email at 720px and 375px: no horizontal page overflow (`scrollWidth - innerWidth = 0` at both widths).
- At 375px with the crest loaded from its canonical file, the header, heading, button, fallback URL, closing and footer all fit within the card.
- With the crest blocked, alt text appears in the header column and the wordmark still reads clearly.

Screenshots were produced in the scratchpad and are not part of the repository.

## C. Colour palette and tokens

The palette is derived from the supplied crest. The values are starting references, not certified brand colours. They are set in `src/styles.css` as shared design tokens. The email template uses the same literal values, because email clients need them.

### Before and after

| Token                                        | Before                                   | After                 | Role                                                  |
| -------------------------------------------- | ---------------------------------------- | --------------------- | ----------------------------------------------------- |
| `--background`                               | oklch(0.975 0.012 85)                    | `#FAF8F2`             | Warm ivory page                                       |
| `--foreground`                               | oklch(0.22 0.03 20)                      | `#242632`             | Dark text                                             |
| `--card` / `--popover`                       | oklch(0.99 0.008 85)                     | `#FFFEFB`             | Surfaces                                              |
| `--primary`                                  | oklch(0.36 0.12 20) (wine)               | `#263A91`             | Crest blue: primary buttons, links, active navigation |
| `--primary-foreground`                       | oklch(0.97 0.015 85)                     | `#FFFFFF`             | Text on primary                                       |
| `--secondary`                                | oklch(0.93 0.02 85)                      | `#EFEBDF`             | Warm neutral                                          |
| `--muted`                                    | oklch(0.94 0.015 85)                     | `#F1EDE3`             | Muted surfaces                                        |
| `--muted-foreground`                         | oklch(0.48 0.03 30)                      | `#5C5A66`             | Secondary text                                        |
| `--accent` / `--accent-foreground`           | oklch(0.92 0.04 85) / oklch(0.3 0.08 20) | `#E7EBF7` / `#1F2F78` | Pale blue tint for selection and hover                |
| `--gold`                                     | oklch(0.48 0.08 80)                      | `#7A6220`             | Antique gold for text (text-safe)                     |
| `--gold-accent` (new)                        | —                                        | `#A4862B`             | Crest gold for decorative rules only                  |
| `--crest-red` (new)                          | —                                        | `#832D32`             | Institutional emphasis (eyebrow labels)               |
| `--destructive` / `--destructive-foreground` | oklch(0.55 0.22 27) / oklch(0.98 0 0)    | `#A3282E` / `#FFFFFF` | Error                                                 |
| `--border`                                   | oklch(0.87 0.025 80)                     | `#DDD6C5`             | Decorative borders only                               |
| `--input`                                    | oklch(0.87 0.025 80)                     | `#8A8476`             | Form control boundaries (3:1 required)                |
| `--ring`                                     | oklch(0.36 0.12 20)                      | `#263A91`             | Focus indicator                                       |
| `--crest`                                    | oklch(1 0 0)                             | `#FFFFFF`             | Crest backdrop                                        |
| `--status-ready`                             | `#226044`                                | `#1F6B45`             | Success text                                          |
| `--status-waiting`                           | `#68522b`                                | `#7A5210`             | Warning text                                          |
| `--status-failed`                            | `#913d38`                                | `#A3282E`             | Error text                                            |
| `--surface-raised`                           | `#fffefa`                                | `#FFFEFA`             | Attachment cards                                      |

Theme colour: `src/routes/__root.tsx` `theme-color` and `public/manifest.webmanifest` `theme_color` and `background_color` changed from `#702d38` and `#faf8f3` to `#263a91` and `#faf8f2`. These are metadata only and do not affect the service worker or installation behaviour.

Styling changes: primary buttons, links, focus rings and active navigation now use crest blue (the token change applies everywhere the token is used). Eyebrow labels use crest red. The page-heading separator uses crest gold as a decorative rule. Gold is not used for text on white.

### WCAG AA contrast (computed with the WCAG relative-luminance formula)

Text needs 4.5:1; large text and UI components need 3:1 (WCAG 1.4.3, 1.4.11).

| Pairing                                       | Ratio | Result                              |
| --------------------------------------------- | ----- | ----------------------------------- |
| Dark text `#242632` on ivory                  | 14.14 | Pass                                |
| Dark text on secondary `#EFEBDF`              | 12.60 | Pass                                |
| Muted text `#5C5A66` on ivory                 | 6.36  | Pass                                |
| Muted text on card `#FFFEFB`                  | 6.70  | Pass                                |
| Muted text on muted `#F1EDE3`                 | 5.78  | Pass                                |
| Crest blue text/links on ivory                | 9.43  | Pass                                |
| White on crest blue (primary button)          | 10.02 | Pass                                |
| Accent text `#1F2F78` on accent `#E7EBF7`     | 10.15 | Pass                                |
| Focus ring `#263A91` on ivory (non-text)      | 9.43  | Pass                                |
| Antique gold text `#7A6220` on ivory          | 5.50  | Pass                                |
| Crest red `#832D32` on ivory (eyebrows)       | 8.29  | Pass                                |
| White on crest red                            | 8.80  | Pass                                |
| Success text `#1F6B45` on ivory               | 6.09  | Pass                                |
| Warning text `#7A5210` on ivory               | 6.50  | Pass                                |
| Error text `#A3282E` on ivory                 | 6.82  | Pass                                |
| White on error `#A3282E` (destructive button) | 7.24  | Pass                                |
| Input border `#8A8476` on ivory (non-text)    | 3.50  | Pass                                |
| Antique gold `#A4862B` as text on white       | 3.49  | **Fails for text; decorative only** |

The brief's original gold `#A4862B` does not meet AA for text, so text uses `#7A6220`. The existing `text-gold` usage (the Roman numerals on the home page, in `src/routes/index.tsx`) therefore renders in the text-safe gold without any file change.

The error red (`#A3282E`) and the crest red (`#832D32`) are close in hue. Errors are announced with text and icons, not colour alone, and the existing components already do this. A separate error hue could be chosen if the Diocese prefers more distinction.

Not tested: a browser-based axe scan and human accessibility review (see [Not done and blocked](#not-done-and-blocked)).

### Hard-coded colours outside the token layer (not changed)

- `src/lib/error-page.ts`: standalone error page, outside the design system. Left unchanged.
- `src/components/submissions/SubmissionDetail.tsx`: `text-emerald-800` for a completed checklist item. Codex's Phase 4.2.2 commit changed this file, so it was not touched in this integration. It can move to a success token in a later change.

## D. Privacy notice

### What was done

- **Active acknowledged notice: unchanged.** `src/lib/privacy/notice.ts` still carries `repository-v1-proposed-2026-11-16`. Its content fingerprint (SHA-256 of the JSON) is `5dc457850c8463d6e5c39730ec55259a1d9962dfcca18dc4d1ff7d7e134391ff`, and a test fails if it changes.
- **Complete proposed Privacy Notice Version 1 draft:** `src/lib/privacy/notice-v1-draft.ts` (structured content, twelve sections in the brief's order) and [docs/privacy-notice-v1-draft.md](privacy-notice-v1-draft.md) (generated from the module, so the two cannot drift; a test checks alignment).
- **Draft identifier:** `repository-v1-draft-2026-11-17`, status `draft-not-approved`, `active: false`. It is not referenced by the registration form, by any acknowledgement or by the database.
- **Unresolved decisions:** [docs/privacy-notice-v1-open-decisions.md](privacy-notice-v1-open-decisions.md), with 23 items in four groups (A: blocking, B: providers and transfers, C: retention, rights and incidents, D: access, operators and product facts).

### Integration with Phase 4.2.2 roles

Codex's administration model (`docs/teft-administration.md`) defines five capabilities: `approver`, `review_coordinator`, `reviewer`, `access_manager` (with a delegated list) and `settings_manager`. Section 6 of the draft now follows that model:

- Review coordinators see routing records and make exact-revision reviewer assignments. The documented role does not authorise reading resource contents, PDFs or notes, and the draft says so.
- Access managers can inspect and change only the capabilities delegated to them for named accounts. The draft notes that whether this role has any content access must be confirmed before approval.
- Approvers and settings managers are stated as separate from reviewer rights, with a note to verify against live permissions.

The administration document was used for these statements. They were not checked against the database, so decision D1 keeps them open.

### Why the notice was not activated

The brief asks that acknowledgement identifiers be preserved, that historical acknowledgements never be rewritten, and that no new legal notice be activated without authorisation. The database enforces the acknowledged version string in several authorization objects, added by migration `0035` and used by `0037`:

- `app.provision_clergy` rejects any other `notice_version`.
- `app.has_consent` accepts only the current identifier (and the legacy `repository-v1` for withdrawal).
- The `consent_append` RLS policy accepts only the current identifier.
- `app.reviewer_operator` (assignment) checks the same identifier.

Switching the acknowledgement to a new revision would require a reviewed, additive database migration that changes consent-acceptance rules and grants. That is an authorization change, so it is outside this communications task. Until it is authorised, showing the new draft in the registration modal would either break registration or record acknowledgement of text under the wrong identifier. The modal therefore still shows the acknowledged text.

### Legal content (summary)

The draft is structured by POPIA concepts (section 18 notice, section 11 lawful grounds, sections 26–28 special personal information, section 72 transfers, access, correction, objection and complaints to the Information Regulator). It states that:

- clergy membership and submitted theological material may reveal religious beliefs, which is special personal information;
- ticking the checkbox is not blanket consent to every processing activity or transfer;
- Bouncer receives the complete PDF, and Bouncer's own published policy states AWS processing in Mumbai (ap-south-1), deletion of uploaded file content within 24 hours and retention of scan metadata while the account is active; these are attributed to the provider and flagged as not independently verified;
- retention periods are not adopted, and no 30- or 90-day promise is made;
- passwords are not intentionally stored in plain text;
- the application's cookie is the httpOnly, SameSite=Lax session cookie (Secure over HTTPS).

No compliance, guarantee, invented approval, invented contact or invented date appears in the draft. Tests check for these phrases.

### Verification of Bouncer statements

The Bouncer privacy page (`https://usebouncer.dev/privacy/`) was retrieved on 17 November 2026 through a summarising fetch, not a verbatim copy. The statements quoted above come from that summary. The Bouncer integration code uploads the complete PDF to a presigned upload target, which confirms that the whole file is transferred. The statements must be re-checked against the verbatim page before launch, and the provider's terms obtained if the Diocese needs them.

## Files changed

In the worktree (`/home/mamba/mts/cape-clergy-vault-comms`, uncommitted, on top of `018bcb4`):

| File                                             | Change                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `src/lib/email/templates.server.ts`              | Rewritten: specifications for all 15 kinds, shared layout, HTML and text generated from one spec, escaping   |
| `src/lib/email/templates.test.ts`                | New: 40 template tests (kinds, rendering, equivalence, escaping, expiry, leakage, tone)                      |
| `src/styles.css`                                 | Palette tokens converted to Diocese values, new gold, crest red and status tokens, two accent rules          |
| `src/routes/__root.tsx`                          | `theme-color` meta changed to crest blue                                                                     |
| `public/manifest.webmanifest`                    | `theme_color` and `background_color` changed to the Diocese values                                           |
| `src/lib/privacy/notice-v1-draft.ts`             | New: structured proposed Privacy Notice Version 1 (not active)                                               |
| `src/lib/privacy/notice-versioning.test.ts`      | New: fingerprint, draft separation, section structure, placeholders, claim checks, Markdown alignment        |
| `docs/privacy-notice-v1-draft.md`                | New: Markdown review copy, generated from the module                                                         |
| `docs/privacy-notice-v1-open-decisions.md`       | New: unresolved decisions for Diocese review                                                                 |
| `docs/communications-branding-privacy-report.md` | New: this report                                                                                             |
| `database/phase42.test.ts`                       | Two exact-subject assertions updated to the new wording (Codex's Phase 4.2 database test; not executed here) |

Deliberately unchanged: `src/lib/privacy/notice.ts`, `src/components/PopiaNotice.tsx`, `src/components/RegistrationFields.tsx`, `src/lib/auth/*`, the Resend and notification worker code, recipients and timing, `database/*` apart from the test assertion above, migrations, RLS and permissions.

## Tests and exact results

All commands were run in the worktree, on `018bcb4` plus these changes.

| Command                                                                                                             | Result                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest run` (full unit suite, including Codex's Phase 4.2.2 unit tests)                                            | **17 test files passed, 121 tests passed, 0 failed**                                                                                                                            |
| `vitest run src/lib/email src/lib/privacy`                                                                          | 3 files, 54 tests passed (4 existing email infrastructure tests, 40 template tests, 10 privacy versioning tests)                                                                |
| `tsc --noEmit`                                                                                                      | **exit 0**                                                                                                                                                                      |
| `eslint` on changed paths (`src/lib/email`, `src/lib/privacy`, `src/routes/__root.tsx`, `database/phase42.test.ts`) | **exit 0**                                                                                                                                                                      |
| `prettier --check` on changed files                                                                                 | All matched files use Prettier code style                                                                                                                                       |
| `eslint .` (whole project)                                                                                          | Exit 1: 625 problems (617 errors, 8 warnings). This count is the same as before integration. None are in files changed by Codex's commit or by this work, so they predate both. |
| `vite build`                                                                                                        | **exit 0**; PWA `generateSW` build completed (precache 62 entries)                                                                                                              |
| Local rendering and screenshots (before integration)                                                                | Email at 720px and 375px, with and without the crest; no horizontal overflow                                                                                                    |

Not run: the database integration suites (including the edited `database/phase42.test.ts`), the browser end-to-end suites (`browser/*.spec.ts`, which select captured email by subject and body text), the Bouncer and ClamAV integration scripts, and any live email. None were run against live services. No real email was sent, and no confidential file was transferred. The subject and body expectations those suites rely on were checked by reading them, not by running them.

## Integration notes (Phase 4.2.2)

1. **Template overlap resolved.** Codex's commit adds `submission_received` and `submission_intake` to `templates.server.ts`. This work keeps both kinds with the same names and new wording. The worker's `submission_intake` URL (`/admin/intake`) still matches the action destination in `emailSpecs`.
2. **Other Codex changes to email.** Codex's commit adds no new email kinds. In the notification worker it changes only the link destination for `submission_intake` (to `/admin/intake`). The sender, idempotency, queue, recipient and send logic are unchanged. The only other overlapping test expectations were the exact subjects in `database/phase42.test.ts`, which are updated.
3. **New kinds added later:** `emailSpecs` is typed `Record<EmailKind, EmailSpec>`, so the compiler flags a missing kind. Update `templates.test.ts`, which pins the list of kinds.
4. **Email URLs:** the crest is loaded from the application origin. The deployed origin must serve `/dct-crest-source.png` publicly. It is in `public/`, and nothing in it requires authentication.
5. **Privacy notice:** do not change `notice.ts` in place. A new revision requires the database work described above and written Diocese authorisation.

## Not done and blocked

- **Activating the new privacy notice revision (blocked).** Requires a reviewed additive migration for the acknowledgement contract and Diocese authorisation (open decision A1).
- **Registration modal content (unchanged, by design).** It shows the acknowledged text. A standalone privacy-notice page was not added, because it would have to show the same acknowledged content and the draft cannot yet be shown as the notice.
- **Font self-hosting (not done).** Cormorant Garamond and Karla are still loaded from Google Fonts, and this is disclosed in the draft. Self-hosting needs the licence check listed in open decision B6, and it touches the root document, so it was left for a later change.
- **Organisational facts (blocked):** responsible party, registered address, Information Officer, privacy contact, retention periods, lawful bases, hosting location, backup location, incident procedure, rights-request process, Information Regulator contact verification, phone-number purpose, notice change mechanism and effective date. All appear as bracketed placeholders.
- **Confidential Bouncer routing (needs engineering check).** The notice says confidential PDFs must not go to an external scanner unless approved. The code path that routes confidential documents was not verified in this work (open decision B1).
- **Browser storage (needs verification).** Some legacy Supabase client modules are still imported by active code, and a preview adapter uses `localStorage`. The notice therefore makes no browser-storage claim beyond the session cookie (open decision D3).
- **Role claims (needs verification).** The access statements in section 6 come from Codex's administration document, not from the live permission rules (open decision D1).
- **Accessibility:** no browser axe scan and no human accessibility or mobile testing were performed. Contrast was computed, not measured in the rendered application.
- **Application screenshots:** the application needs the database and authentication stack, which was not started for this work. The palette was checked through token values, contrast calculations and a successful build, not by viewing the running pages.
- **Crest and email deliverability:** not tested with live clients or providers. Image loading and spam scoring depend on the deployed origin and the sender domain.
