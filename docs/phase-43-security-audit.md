# Phase 4.3 — Security, quality and MVP release audit

Audit date: 17 November 2026 (Africa/Johannesburg). Written for: the repository owner, the Diocese
Information Officer and engineering reviewers deciding on staging and pilot readiness.

This was an audit and targeted remediation phase. No feature was added, nothing was deployed or
committed, no VPS was contacted, no live Resend mail was sent, no real document was sent to
Bouncer, the persistent development database was only read, and no history row, trigger or
historical migration was changed. Only evidence produced **in this session** is reported as
passed. Earlier-phase results are cited only as context and marked as such.

## 1. Source revision audited

| Item                     | Value                                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch / base commit     | `feat/self-hosted-migration` @ `43572c76580ae985ee6297d1557bcd484fb509f7`                                                                                                                                               |
| Tree at start            | Clean (no concurrent uncommitted work was present; a re-check before finishing showed only this phase's changes)                                                                                                        |
| This phase's changes     | Uncommitted working-tree changes (listed in section 5). **No commit/push/merge was made.**                                                                                                                              |
| Runtime                  | Node v24.12.0, npm 11.7.0, Bun (lockfile `bun.lock`, no `package-lock.json`), PostgreSQL 18.6 (persistent cluster, port 55432)                                                                                          |
| Key dependencies         | better-auth 1.7.16, drizzle-orm 0.45.4, @tanstack/react-start 1.168.60, vite 8.1.5, zod 3.25.76 / 4.6.5                                                                                                                 |
| Migrations               | 38 applied in the persistent database at audit start (latest `0037_phase422_administration`); this phase adds **`0038_bouncer_confidential_gate`**, applied to disposable clusters only                                 |
| Scanner configuration    | Persistent protected env selects `CAPE_SCANNER=bouncer` with a Bouncer API key; **`BOUNCER_UPLOAD_HOST` is unset** (value-free check of key names/mode 0600; no secret was printed). Only `.env.example` is tracked.    |
| Persistent RLS inventory | 29 `app` tables, all with RLS; `auth` has four Better Auth provider tables without RLS (`accounts`, `sessions`, `users`, `verifications`) by design                                                                     |
| Database roles           | `cape_clergy_dev` (non-superuser owner of all objects), `cape_clergy_runtime`, `cape_clergy_scanner`, `cape_clergy_notifications` (all `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`, no memberships) |
| Effective execute grants | runtime 43 functions, scanner 6, notifications 5; runtime has table DML on 20 reviewed tables, worker roles have none                                                                                                   |

## 2. Scope and methodology

Read: `AGENTS.md`, Phase 4.1B/4.2/4.2.1/4.2.2 reports, release-readiness matrix, privacy register and
Notice v1 open decisions, Bouncer/worker/production docs, migration 0037, document/Bouncer/auth/HTTP
code, `server.ts`, the nginx/PM2 templates.

Executed (all current): typecheck, full ESLint, Vitest, production build, `bun audit`, repaired
Phase 3E/3F read-only audits against the persistent database, and — in whole disposable PostgreSQL
clusters on 55433 from a sanitized source snapshot with captured mail and mocked providers — the
Bouncer/scanner suite, registration/notification suite, owner-verification suite, Phase 4.2.2
administration suite, 24 Chromium checks (four viewports, axe), the new Phase 4.3 probes, the
recovery drill, `test:bouncer`, `test:scanner` and `db:test:unit`.

**Not covered / limits.** I did not independently re-read every function body (for example
`decide_review`, `can_review_submission`, RLS policy text, rate-limit and email-service internals);
for those I rely on the suites that ran today and on the pinned grant/search-path contract.
Chromium only: no Safari/Firefox/physical devices, no human screen-reader pass. The installed-daemon
ClamAV test skipped (no socket). No real Bouncer, Resend or VPS interaction occurred.

## 3. Findings

No **Critical** issue was identified. Severity reflects impact on the stated release gates.

### High

**H-1 — Confidential resources' PDFs could be newly sent to the external scanner. REMEDIATED (code); not yet applied to the persistent database.**
Evidence: neither `claim_bouncer_scan`/`reserve_bouncer_scan` (migration 0034) nor
`src/lib/scanning/*` reference `submissions.confidential`; Privacy Notice open decision B1 recorded the
routing as "not verified". The persistent environment has a Bouncer key configured. A new test
(F-02) fails on the pre-fix migration set (executed: 11 pass / 2 fail) and passes with
`0038_bouncer_confidential_gate.sql` (13/13). Fix: Bouncer neither claims nor reserves a document whose
parent submission is confidential; already provider-accepted work still polls (bytes already
transferred cannot be recalled). Confidential PDFs now stay quarantined and are never "clean", so
confidential submissions with PDFs cannot complete verification until a separately approved route
exists. This is the intended fail-closed behaviour pending B1/B2, not a feature gap.
**Action required by the owner:** apply 0038 to the persistent database with the reviewed `npm run db:migrate`
before running the scanner worker with the real Bouncer key there. Until then the persistent database
still has the old claim function. The persistent audit currently (correctly) fails its ledger check for
this reason (see section 6).

**H-2 — Delegation allows single-person self-escalation to reviewer of confidential work. NOT remediated: owner policy decision required.**
Evidence: `app.manage_access` blocks self-_grant/revoke_ but not self-_invite_
(`identity=actor AND action IN ('grant','revoke')`); probe output
`{"blocks_self_grant_revoke_only":true,"invite_to_self_allowed":true}`. The Phase 4.2.2 suite
deliberately exercises the path: a coordinator invites themselves as reviewer, accepts with mailbox proof,
then `coordinate_assignment` on another author's **confidential** submission makes
`app.can_review_submission` true. One account holding `access_manager` (delegating `reviewer`) and
`review_coordinator` can therefore grant itself access to confidential material with no second person.
This contradicts the standing rule in `AGENTS.md` ("No self-review, self-assignment…" and "Admin does not
imply … confidential-material access"); the 4.2.2 report records coordinator self-assignment as an owner
request that "narrowly supersedes" it. I did not weaken or alter this behaviour because it is a policy
choice. Options for the owner: forbid self-invitation, forbid self-assignment to confidential items, or require a
second actor. **Blocks any confidential use and a real-clergy pilot until decided; acceptable for synthetic staging.**

### Medium

**M-1 — The advertised 20 MiB scan capability is unproven; PDFs above 4 MiB are held.** `BOUNCER_UPLOAD_HOST`
is unset; the adapter correctly refuses (`unsafe_destination`) before any `/v2/scan` call (no quota is spent),
and the database moves the document to `exhausted`/`held`. The author sees the generic "Verification
unsuccessful" text, with no hint that size is the cause, and I found no documented operator re-queue step.
Not remediated: I did not invent or relax a host, and live acceptance needs separate authorization.
Mock coverage of the v1 and v2 paths (8 adapter tests, 24 database tests) passes, but the real S3 contract is unverified.

**M-2 — No Content-Security-Policy or framing protection on HTML responses.** Only API/document responses
carry hardening headers; the nginx template had none. Remediated partly: the template now sets HSTS
(without `includeSubDomains`, since the VPS is shared), `X-Frame-Options: DENY`, `nosniff`,
`Referrer-Policy` and `Permissions-Policy`. They sit at the proxy, not in the app, because the legacy
Lovable preview iframes the app in development. A CSP needs a reviewed nonce design (TanStack inline
hydration) and the Google Fonts decision (open item B6).

**M-3 — Dependency advisories (`bun audit`): 31 (13 high, 14 moderate, 4 low), none critical.**
Runtime-relevant: `zod` < 4.6.6 (memory exhaustion on oversized collections; request bodies are capped at
32 KiB, which limits but does not remove exposure) and `seroval` (SSR serialization, moderate). The remainder are
build/dev tooling (`brace-expansion`, `glob`, `js-yaml`, `minimatch`, `nanoid`, `source-map-js`, `vite`/`launch-editor`,
`esbuild`). Not patched: upgrades need a full regression run and a lockfile change.

**M-4 — The runtime database role trusts the `cape.user_id` session setting.** Any code or SQL
injection running with the runtime credential can claim any user's identity within the function/RLS
boundary. This is the intended design, and the guard is that only the verified-cookie server path sets it, but it
makes the runtime credential and handler code the trust boundary. Probes confirmed identity-less and cross-user
access fail; the setting itself is not attested.

**M-5 — Persistent database is behind the repository by one migration.** See H-1; `npm run db:status` / the audits will report this until applied.

### Low

- **L-1 (remediated).** The 4.2.2 pages `/admin`, `/admin/intake` and `/admin/access` had no server-side page gate (unlike the other admin pages)
  and `/admin` itself missed the `no-store` rule. `server.ts` now applies the existing verified/approved/consented
  account gate and cache headers to them. Capability enforcement remains in `/api/administration` and the database.
  Verified by the browser suite below.
- **L-2.** Session lifetime/update age and reset-token expiry rely on Better Auth defaults (library default reset expiry is 3600 s); only email verification is pinned (3600 s). Pin them explicitly.
- **L-3.** Better Auth provider tables have no RLS and the runtime role has full DML on them. Pinned and audited as an intentional exception.
- **L-4.** The reviewer notification worker needs `BETTER_AUTH_SECRET` to open sealed invitation proofs, so that secret is not confined to the web process.
- **L-5.** The client bundle includes Better Auth's env helper that _names_ `BETTER_AUTH_SECRET` (no value). The audit no longer treats the bare name as a leak but matches configured secret values.
- **L-6.** An access manager can revoke another manager's delegated capabilities within its own ceiling (audited availability risk).
- **L-7.** Two React fast-refresh warnings remain in legacy files (`submission-utils.tsx`, `dashboard.tsx`).
- **L-8.** Legacy Supabase-era files (isolated read-only references) carried `any`/formatting lint errors; fixed without changing behaviour.

## 4. Audit-tool repairs (Section B)

`scripts/db/phase3e-audit.ts` and `phase3f-audit.ts` hard-coded 36 ledger rows, 26 RLS tables, 5 notification
functions and empty capture directories, and read `.output/public` unconditionally. They now call a shared,
read-only contract (`database/security-contract.ts`) which:

- derives expected migrations from the SQL files and journal and compares each applied hash **in order**;
- requires RLS on **every** `app` table (29 today) plus a pinned list including the new TEFT administration tables, and
  limits the non-RLS exception to the four Better Auth tables; forbids views;
- pins exact function execute sets per role (43/6/5, including administration, scanner and notification functions), exact
  runtime table access, no table/column access for worker roles, no access to 12 operator-only tables, and denial of
  direct status/decision/assignment/role writes and cross-role function calls;
- checks role attributes/memberships, 77 `SECURITY DEFINER` functions pinned to `search_path=pg_catalog`, no PUBLIC execute, one non-superuser owner;
- verifies the original ten append-only histories plus three operator-evidence tables keep enabled reject triggers
  and that eight workflow triggers are enabled and none is disabled or replica-only;
- classifies captures as retained development vs disposable fixture, requires owner-only permissions, and **never requires deletion**;
- always runs the browser-artifact credential scan (hard failure if no build exists) using five pattern classes plus configured secret values.

No trigger was bypassed, no history deleted, no grant added, no historical migration rewritten. The same
contract also runs inside the disposable suite (`npm run test:phase43`), which proves a fresh forward-migrated
cluster plus the reviewed `*-grants.sql` files produces the identical contract (drift detection).

## 5. Remediations implemented (all uncommitted)

| Change                                                                                                                        | Purpose                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `database/migrations/0038_bouncer_confidential_gate.sql`, journal entry, `meta/0038_snapshot.json`                            | H-1 fail-closed gate (forward-only, `CREATE OR REPLACE`) |
| `database/security-contract.ts`; rewritten `scripts/db/phase3e-audit.ts`, `phase3f-audit.ts`                                  | Section B                                                |
| `database/phase43.test.ts`; `scripts/db/phase41b-test.ts` / `phase42-test.ts` `--phase43` mode; `package.json` `test:phase43` | New synthetic probes inside a disposable cluster         |
| `src/server.ts`                                                                                                               | L-1                                                      |
| `ops/nginx.conf.example`                                                                                                      | M-2 baseline headers (template only; nothing deployed)   |
| `eslint.config.js`; formatting of 28 tracked `src/` files; typed `catch` blocks and a few `any`/`const` fixes in legacy files | Lint baseline (L-8)                                      |

The lint configuration now ignores only generated/ignored/disposable output (`dist`, `.output`, `.vinxi`, `.nitro`,
`.tanstack`, `.local`, `playwright-report`, `test-results`) and the generated historical Supabase `types.ts` snapshot. No
tracked source file or security rule is hidden. The shadcn `ui/` primitives have a file-scoped exception for the dev-only
`react-refresh/only-export-components` hint.

## 6. Tests executed and actual outcomes

| Check                                                                    | Outcome (this session)                                                                                                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                      | Passed (before and after changes)                                                                                                                                      |
| `npx eslint .` (baseline before work)                                    | **Failed:** 691 problems (683 errors, 8 warnings); 673 formatting, 17 real; `.local/` scripts were linted                                                              |
| `npx eslint .` (after)                                                   | 0 errors, 2 warnings (L-7)                                                                                                                                             |
| `npx vitest run`                                                         | 17 files, 121 tests passed (baseline and again on the final tree)                                                                                                      |
| `npm run build`                                                          | Passed                                                                                                                                                                 |
| `npm run db:audit:phase3e` / `3f` (persistent, before 0038 existed)      | Both passed: 38 hashes in order, 29 RLS tables, reviewed grants, 77 definers, 13 immutable-history tables, 3 retained development captures, 67 artifacts scanned       |
| `npm run db:audit:phase3e` (persistent, **after** adding 0038)           | **Fails by design:** "Ledger row count must equal reviewed migration files" (39 files, 38 applied). Passes once 0038 is applied; not applied by me                     |
| `npm run test:phase43` (new, disposable)                                 | 13/13 passed (contract on a fresh cluster; horizontal/vertical probes; F-02). Pre-fix: 11 passed, **2 failed** (confirms the finding)                                  |
| `npm run test:phase422` (disposable, after 0038, before `server.ts`)     | Bouncer/scanner DB 24/24; registration/notification 13/13; owner-verification 6/6; administration 12/12; Chromium 24/24 across 320/390/768/1440 px with axe            |
| `npm run test:phase422` (final, after `server.ts` and all other changes) | Exit 0: Bouncer/scanner DB 24/24; registration/notification 13/13; owner-verification 6/6; administration 12/12; Chromium 24/24 with axe                               |
| `npm run test:bouncer`, `test:scanner`, `db:test:unit`                   | 8/8; 14 passed + 1 skipped (no clamd socket); 3/3                                                                                                                      |
| `npm run test:recovery`                                                  | Passed: encrypted coordinated backup, isolated restore, ledger/hash/RLS/audit IDs preserved, missing/orphan object detection, lease recovery. TestScanner is synthetic |
| `bun audit`                                                              | 31 advisories (13 high / 14 moderate / 4 low / 0 critical) — M-3                                                                                                       |

Initial failures were investigated, not hidden: two attempts of the new test failed on my own mistakes (assuming an
empty table fires a row trigger; staging a non-document draft). Both were fixed in the test, not in any
protection. A first-run browser-artifact scan flagged Better Auth's env-name string (L-5).

## 7. Security controls verified (current evidence)

- Browser/HTTP boundary: strict Origin, JSON-only, 32 KiB bounded bodies, non-enumerating failure mapping, `no-store` private
  headers, fixed redirects, strict verify/reset callback allow-list, `Secure/HttpOnly/SameSite=Lax` cookies, email verification required,
  12–128 character passwords, sessions revoked on password reset and on capability/reviewer revocation (suite).
- Database boundary: sections 1 and 4; ordinary clergy cannot call any privileged function or write privileges, assignments,
  decisions, status or evidence (probes); administrators have no implicit reviewer or confidential access; revocation
  is immediate without a new login; hostile `search_path` cannot hijack definers; owners and runtime cannot
  truncate/alter histories.
- Reviewer model: exact-revision, no author self-review, activation by one-hour mailbox-bound proof (Phase 4.2.2 suite, 12/12).
  **Caveat: H-2.**
- Files: exact 20 MiB cap in browser (zero requests on rejection) and streaming server (unit + browser suites), PDF header/trailer checks,
  `O_EXCL|O_NOFOLLOW` 0600 private objects with ancestor symlink checks, hash/size matching, clean-evidence
  predicate before download, authorization + start audits before bytes, sandbox/attachment headers, confidential intake projection withholds
  metadata (suites).
- Bouncer adapter: exact-host pin, `redirect: error`, key not sent to S3, scan-ID/key binding, free-quota reservation, quota back-off,
  restart/ambiguous-submission handling (mocks only).
- Notifications: transactional intents, stable keys, leases/retries, mailbox-change invalidation, no submission contents in email
  templates (HTML-escaped, link-only), captured-mail only.
- Recovery: see section 6.

## 8. Outstanding blockers

**Technical**

1. Apply 0038 to the persistent database (owner action); rerun both audits. (H-1/M-5)
2. Decide and implement the H-2 policy; retest.
3. Obtain and independently verify the exact `BOUNCER_UPLOAD_HOST`; run separately authorized harmless live acceptance of `/v2/scan`; add user-facing guidance or an operator re-queue procedure for held large PDFs (M-1).
4. Nonlocal PostgreSQL connection factories, dedicated database and restricted roles, TLS and role-ownership review — the factories deliberately accept only the local marker endpoint (reviewed blocker, unchanged).
5. Filesystem/process/secret isolation on the shared 4 GB VPS: same-owner 0700 storage means web, scanner and workers need a reviewed namespace and per-process secret mounts (including L-4); never loosen permissions or reuse another application's database credentials.
6. Nginx/TLS/DNS, CSP design, response headers deployed and verified (M-2); independent worker supervision; health/alert collector and Bouncer quota monitoring; capacity and shared-rate-limit load tests; encrypted coordinated off-host backups and restore rehearsal with key custodians.
7. Dependency upgrades with regression (M-3); pin session/reset lifetimes (L-2); optional runtime-identity attestation (M-4).
8. Live Resend deliverability and invalid-key acceptance; physical Android/iOS/Safari/Firefox and human screen-reader acceptance.

**Organizational** (all unresolved; none invented here): Diocese responsible party/contact and Information Officer; purposes and lawful grounds;
special personal (religious) information basis; confidential-resource processing; Bouncer external processing and international
transfer, provider terms and retention; Resend and hosting agreements; rights requests and complaints; record retention and legal holds;
incident response; backup/support ownership; Notice v1 approval and the consent-version migration (A1). I checked each item against `privacy-notice-v1-open-decisions.md` (sections A–D, every item open) and
`privacy-approval-register.md`: responsible party/Information Officer (A2), lawful basis and religious special information (A3), Bouncer and
confidential PDFs (B1), Bouncer transfer (B2), Resend/hosting terms (B3–B4), rights requests (C2), incidents (C3), Information Regulator/complaints
(C5, there is no standalone "complaints" row), retention/holds and backup/support ownership are all recorded as open with no invented owner,
date or retention period. The consent-version migration (A1) is also open.

## 9. Decision: isolated synthetic VPS staging

**GO for isolated synthetic-data staging, subject to the preconditions below. No deployment is authorized by this report.** Synthetic data only, no real clergy or documents, a dedicated
database and credentials, and no Bouncer key or real mail. Before provisioning: apply 0038 and get clean audits; resolve blockers 4–6 above at
design level; keep H-2 acknowledged as open; and keep `BOUNCER_UPLOAD_HOST`/live Bouncer out of scope. The code has no critical finding and the
current local evidence is strong, but staging has not been designed or tested on the target.

## 10. Decision: real-clergy MVP pilot

**NO-GO.** Independent of engineering, the privacy notice, lawful grounds, Information Officer, Bouncer transfer approval, retention,
incident response and backup ownership are unapproved. Technically, H-2 is undecided, large-PDF scanning is unproven (M-1),
infrastructure is unprovisioned and untested, and deliverability, physical-device and human-accessibility acceptance have not run. No unrestricted
confidential readiness is claimed.
