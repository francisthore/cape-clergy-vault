# Cape Clergy Vault — Phase 4.1B implementation report

Date: 16 November 2026, Africa/Johannesburg. Repository:
`francisthore/cape-clergy-vault`; branch: `feat/self-hosted-migration`.

## Outcome and scope

Bouncer is implemented as an optional external scanner within the existing private
quarantine architecture. ClamAV remains supported. The browser enforces the exact
20 MiB selection boundary before any request; the server independently enforces
actual streamed bytes. The audit follow-up corrects both fixture assertions while
preserving all three synthetic audit records. Both security audits now pass;
retained append-only evidence is verified separately from live fixture state.
Durable provider submission/acceptance/polling, provider-specific
SQL evidence and conservative free quota protection are implemented and tested locally.

This is repository engineering and disposable local acceptance. No production/staging
deployment, live provider scan, real clergy upload, paid service, automatic commit, push or merge
was performed. No privileged user/reviewer grant was made. Michael's attribution,
Better Auth, RLS, private streaming downloads, consent/review boundaries, isolated
legacy interfaces and PWA/offline guarantees are retained.

## Checkpoints A–H

| Checkpoint             | Delivered behavior                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: frontend            | Shared browser-safe `MAX_PDF_BYTES = 20971520`; immediate input/drop size, empty, extension/MIME feedback; accessible inline alert, input error association, replacement, explicit disabled-until-valid upload action and synchronous duplicate guard. Invalid selection makes no request and no document reservation.                                                              |
| A: backend             | Same constant used by server runtime/service/storage and scanner ceiling; independent actual-byte streaming, PDF header/trailer, filename/MIME, hash, ownership, live account/consent, editable-state and quarantine enforcement retained. Existing review-only proxy template already allows `21m`; no proxy was changed.                                                          |
| B: adapter             | Fixed HTTPS Bouncer API, X-API-Key, v1 multipart through 4 MiB, v2 target + bounded streaming above 4 MiB through 20 MiB, common status reads, usage GET, sanitized errors, 64 KiB response ceiling, redirect refusal and exact pinned AWS destination/key validation. No extra SDK or hosting dependency.                                                                          |
| C: durable work        | Provider/ID, expected hash/size, revision, submission/poll times, provider status, result category, retry/poll counters and correlation persist. Committed submission marker prevents ambiguous re-upload; accepted IDs resume polling after restart. Lost database acknowledgement preserves the lease for recovery. No provider/file I/O inside a transaction.                    |
| D: verification        | Only completed clean + exact ID/hash/size + freshly rehashed local bytes can promote. SQL independently checks evidence, live lease/revision/exclusion and eligible author. Malicious remains infected; suspicious/invalid/failed/unknown evidence remains unavailable.                                                                                                             |
| E: database            | Two forward migrations; provider-specific evidence without fabricated ClamAV metadata. Dedicated scanner functions only, no direct table writes or runtime scan grants. Existing immutable histories, RLS, clean predicate, audited downloads and submission gates retained.                                                                                                        |
| F: configuration/quota | Only clamav/bouncer configuration; production test injection denied. Worker-only protected key and exact upload host. Free tier/current UTC period/limit <=500 required; account-wide conservative durable reservation, monthly quota backoff, no paid fallback. Scanner-only dependency failures, including missing worker-only configuration in web, yield degraded availability. |
| G: tests               | Mocked adapter plus actual restricted local database tests; browser boundary/zero-request checks in four viewports; independent server/HTTP boundary checks; Phase 3A–4 regressions, built HTTP smoke tests, grant/hash audits, typecheck and build. Results below.                                                                                                                 |
| H: readiness           | Provider processing/transfer/retention, POPIA approval considerations, quota, configuration, outages and recovery documented. Release matrix continues to deny unrestricted confidential readiness.                                                                                                                                                                                 |

The official [API reference](https://usebouncer.dev/docs/) was checked during implementation.
The [provider privacy policy](https://usebouncer.dev/privacy/) states Mumbai AWS processing,
24-hour content deletion and account-lifetime scan metadata retention. These statements
are not independent provider assurance or Diocese approval. See the
[Bouncer runbook](bouncer-scanning.md) for exact operational constraints.

## Migrations and restricted SQL

- `0033_scanner_provider_evidence.sql`: adds provider-specific scan evidence, expected
  size/revision, durable provider timestamps/status/result, polling/failure counters
  and a clean-evidence constraint supporting either authentic ClamAV metadata or
  complete Bouncer evidence.
- `0034_bouncer_orchestration.sql`: private RLS `scanner_budget`; worker-only
  `claim_bouncer_scan`, `reserve_bouncer_scan`, `accept_bouncer_scan` and
  `finish_bouncer_scan`; append-only scan/audit events; one tracked external job
  in flight; lease fencing; conservative quota reservations and terminal ambiguity.
  Existing ClamAV claim/finalization functions are replaced forward to reject
  Bouncer evidence and preserve their previous behavior.
- Matching Drizzle snapshots/journal are included. Existing migrations 0000–0032 were
  not edited. The guarded local ledger now has 35 matching migrations and 26 app RLS
  tables (plus four auth tables). Generation reports no remaining schema difference.
- Existing scanner setup grants now include only the four additional narrow functions.
  Every function still checks actual scanner `session_user`. No application/runtime
  ability to forge clean verdicts or read scan/budget evidence was introduced.

The existing marked project-local PostgreSQL cluster was initially stopped. Earlier
acceptance used its guarded `127.0.0.1:55432/cape_clergy_vault_dev` target. During this
follow-up it was opened only for read-only audits/preservation checks, then stopped
again. Bouncer integration reruns now use whole fresh disposable clusters instead;
no inherited database URL or private environment is loaded by that runner. Protected ignored environments were retained; no credentials are printed or
included in this report. Disposable accounts/documents/captured email/private test objects are
cleaned by the original suites. The three earlier synthetic download-audit rows
remain intact. The corrected Bouncer suite retains all committed history for its
whole disposable environment; it has no row-level history teardown. No other database/application was altered.

## Exact automated results

The counts below are command-reported totals, including parent tests where Node's
runner includes them. Provider responses are mocked; no live Bouncer API test ran.
The follow-up reran the Bouncer suite, both audits, unit tests, typecheck, targeted
lint and migration checks. The earlier browser/HTTP/Phase 3A–4 suite results remain
historical acceptance evidence, not claims of another run during this follow-up.

| Command                                                                                     | Result                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm test -- --reporter=dot`                                                                | 49 passed, 12 files, 0 failed                                                                                                      |
| `npm run test:bouncer`                                                                      | 8 passed, 0 failed                                                                                                                 |
| `npm run db:test`                                                                           | 3 passed, 0 failed                                                                                                                 |
| `npm run db:test:auth`                                                                      | 10 passed, 0 failed                                                                                                                |
| `npm run db:test:phase3a`                                                                   | 12 passed, 0 failed                                                                                                                |
| `npm run db:test:phase3b`                                                                   | 17 passed, 0 failed                                                                                                                |
| `npm run db:test:phase3c`                                                                   | 19 passed, 0 failed                                                                                                                |
| `npm run db:test:phase3d`                                                                   | 10 passed, 0 failed                                                                                                                |
| `npm run db:test:phase3e:boundary`                                                          | 5 passed, 0 failed                                                                                                                 |
| `npm run db:test:phase3e`                                                                   | 22 passed, 0 failed                                                                                                                |
| `npm run db:test:phase3f`                                                                   | 18 passed, 0 failed                                                                                                                |
| `npm run db:test:phase3f:notifications`                                                     | 10 passed, 0 failed                                                                                                                |
| `npm run db:test:phase4`                                                                    | 17 passed, 0 failed                                                                                                                |
| `npm run db:test:phase41b`                                                                  | 24 passed, 0 failed, 0 skipped; repeated in two fresh disposable clusters                                                          |
| `npm run test:scanner`                                                                      | 14 passed, 1 skipped, 0 failed; real clamd socket absent                                                                           |
| `npm run test:browser`                                                                      | 20 passed, 0 failed/skipped/flaky; four Chromium viewports, 5.8 minutes                                                            |
| `npm run typecheck`                                                                         | Passed                                                                                                                             |
| `npm run db:check`                                                                          | Passed                                                                                                                             |
| `npm run db:generate`                                                                       | Passed; no remaining schema changes                                                                                                |
| `npm run build`                                                                             | Passed; existing dependency deprecation/tsconfig-path notices only                                                                 |
| Targeted ESLint on new/changed scanner, upload, health, schema, test and monitoring sources | Passed                                                                                                                             |
| `git diff --check`                                                                          | Passed                                                                                                                             |
| Independent final browser-artifact scan                                                     | Passed: 53 artifacts, no Bouncer implementation or configured private credentials                                                  |
| `npm run db:smoke:phase3a`                                                                  | Passed built HTTP registration/verification/cookie/session checks                                                                  |
| `npm run db:smoke:phase3b`                                                                  | Passed built HTTP approval/capability/idempotency/revocation checks                                                                |
| `npm run db:smoke:phase3c`                                                                  | 12 passed, 0 failed; includes exact-limit and chunked oversized HTTP checks                                                        |
| `npm run db:smoke:phase3d`                                                                  | Passed built HTTP submission/settings/confidentiality/audited-byte flow                                                            |
| `npm run db:smoke:phase3e`                                                                  | 22 passed, 0 failed                                                                                                                |
| `npm run db:smoke:phase4`                                                                   | Passed built Node proxy/client-bucket/degraded readiness checks                                                                    |
| `CAPE_SCANNER=bouncer npm run db:smoke:phase4`                                              | Passed; no worker API key in web environment, degraded HTTP 200                                                                    |
| `npm run db:audit:phase3e`                                                                  | Passed: 35 migration hashes, 26 RLS tables, protected histories, no live fixtures, three audit rows retained, 53 browser artifacts |
| `npm run db:audit:phase3f`                                                                  | Passed: same preservation/fixture evidence plus restricted scanner/notification grants and private-artifact checks                 |

Both previously unsuccessful audit commands now pass without deleting any retained
record or relaxing database enforcement. The former failures remain in the older
local logs; the follow-up logs below record their resolution.

Ignored raw logs live under `.local/phase41b-results/`; browser machine results are
`.local/browser-report.json`. These are local review artifacts, not committed evidence
or production monitoring.

The browser selection test covers a smaller valid PDF, exactly 20,971,520 bytes,
20,971,521 bytes, empty PDF, invalid extension/MIME, oversized drop, invalid-to-valid
replacement, native file input at mobile sizes, alert association/axe checks and
same-task duplicate clicks. It asserts **zero upload POSTs and zero document rows**
after invalid input/drop; the subsequent valid upload produces exactly one request/row.
The server test accepts an actual exact-limit PDF, rejects actual oversized bytes
with a forged short Content-Length in the service harness, and separately exercises
ordinary and chunked oversized HTTP requests.

The 24-test isolated database suite additionally exercises an exact 20 MiB v2 upload with
persisted ID before S3, clean/malicious/suspicious/invalid outcomes, independent hash,
size and local-byte mismatch, pending exhaustion, post-acceptance outage, ambiguity,
restart and lost-commit acknowledgement, duplicate/concurrent claims, stale/cross-provider
finalization, exclusion/revision/consent revocation, missing evidence and quota holds.
Adapter tests cover malformed/oversized JSON, status/verdict types, timeout/unavailability,
unsafe destinations/redirects/credential separation, usage validation and configuration.

## Security findings and practical limits

1. The old ClamAV evidence requirement could not represent Bouncer honestly; the new
   conditional constraint and separate finalizer solve that without invented versions
   or broadened web privileges. Existing ClamAV evidence remains intact.
2. Bouncer documents no idempotency contract. A committed `submitting` marker with no
   durable ID is held for operator investigation. This may consume allowance without
   a usable scan, including crashes before an HTTP call. It never causes automatic
   re-upload. Ambiguous or exhausted jobs are not automatically reset.
3. An accepted v2 ID can survive a crash before upload completes. Credentials are not
   stored/replayed. Recovery polls that ID; pending work eventually reaches its bound
   and remains unavailable. Local scheduling bounds tracked work; a provider operation
   may outlive our timeout/hold, and no remote cancellation guarantee is claimed.
4. The quota ledger deliberately over-reserves against stale provider counts. Use a
   dedicated free account; unrelated callers cannot participate in our database lock.
   Only a verified free tier is accepted; no plan/billing mutation exists.
5. The worker credential, provider and host OS remain trusted boundaries. A compromised
   scanner can lie; a trusted OS can alter bytes after the last hash. Detection is not
   PDF sanitization, and revocation cannot recall transferred bytes.
6. The initial new fixture committed a synthetic download-start authorization probe,
   while its old cleanup helper covered only `document.scan.%` audit actions. Three
   earlier runs left three audit records after deleting their disposable documents.
   The user denied deletion. The records are intentionally retained, with their
   complete row content/count verified unchanged. The old audit scripts incorrectly
   asserted that retained audit/review history must be empty. The fixture-scoped,
   read-only checks and isolated runner described below correct that assumption.
7. Synchronous scanner configuration failure previously escaped dependency settlement
   and could make readiness unavailable. Readiness now settles such failures as scanner
   degradation, preserving ordinary application availability without a web Bouncer key.

## Outstanding blockers and approvals

- The earlier fixture-audit blocker is resolved. All three historical synthetic
  audit records remain preserved; no permission to delete them is sought or needed.
- No live Bouncer acceptance was authorized. Owner-reported earlier v1/usage/hash
  results are context, not new evidence. Live v2/S3, quota/timeout behavior and real
  detection need separately authorized harmless disposable acceptance.
- The exact production Bouncer S3 bucket is not documented publicly or invented here.
  Independently verify and set the exact approved Mumbai upload hostname. Large files
  fail closed without that pin before quota reservation.
- Diocese approval remains required for third-party/cross-border document transfer,
  processor contract, notice/lawful basis/consent arrangements, confidentiality scope,
  retention/rights handling and incident ownership. Confidential clergy transfer is
  not approved by this implementation or the owner's successful API connection.
- Existing target-specific DB/host isolation, TLS, capacity, scheduling, on-call alerts,
  deliverability, backup/restore and privacy/retention release prerequisites remain.
  No extra VPS, paid infrastructure, daemon or production service was provisioned.
- Physical Android/iPhone/tablet, Safari/other engines and human screen-reader acceptance
  remain open; Playwright viewport/axe evidence does not close them.
- Optional ClamAV real-daemon acceptance remains untested; its adapter is preserved,
  with the explicit real-socket test skip rather than a fabricated pass.

Stop point: Phase 4.1B repository implementation only. No deployment or later phase is
implied. The release-readiness matrix remains a controlled-scope assessment with
organizational and live-provider blockers open.

## Files changed

- `.env.example`
- `browser/acceptance.spec.ts`
- `browser/pdf-validation.spec.ts`
- `database/disposable-phase41b.server.ts`
- `database/integration.test.ts`
- `database/migrations/0033_scanner_provider_evidence.sql`
- `database/migrations/0034_bouncer_orchestration.sql`
- `database/migrations/meta/0033_snapshot.json`
- `database/migrations/meta/0034_snapshot.json`
- `database/migrations/meta/_journal.json`
- `database/phase3c.test.ts`
- `database/phase41b.test.ts`
- `database/runtime-grants.sql`
- `database/scanner-grants.sql`
- `database/schema/scanning.ts`
- `database/test-fixture-audit.ts`
- `docs/bouncer-scanning.md`
- `docs/document-scanning.md`
- `docs/operations-monitoring.md`
- `docs/phase-41b-report.md`
- `docs/privacy-retention-readiness.md`
- `docs/release-readiness.md`
- `docs/worker-supervision.md`
- `package.json`
- `scripts/db/phase3e-audit.ts`
- `scripts/db/phase3f-audit.ts`
- `scripts/db/phase4-http.ts`
- `scripts/db/phase41b-test.ts`
- `scripts/db/scanner-usage.ts`
- `src/components/submissions/SubmissionDetail.tsx`
- `src/lib/documents/runtime.server.ts`
- `src/lib/documents/service.server.ts`
- `src/lib/documents/storage.server.ts`
- `src/lib/documents/validation.test.ts`
- `src/lib/documents/validation.ts`
- `src/lib/operations/health.server.ts`
- `src/lib/operations/health.test.ts`
- `src/lib/scanning/bouncer-worker.server.ts`
- `src/lib/scanning/bouncer.integration.ts`
- `src/lib/scanning/bouncer.server.ts`
- `src/lib/scanning/scanner.server.ts`
- `src/lib/scanning/worker.server.ts`

The pre-existing `.env.example` Bouncer selection and empty key were retained; the
duplicate scanner selector was removed and the exact upload-host setting documented.
No private environment contents were copied. Legacy attribution and applied migration
files were not changed. Audit ledger/RLS count expectations were advanced for the new
migrations/table. The follow-up corrects the fixture assertions as documented below;
no database history protection was weakened.

## Audit assertion and fixture-isolation follow-up

The user's denial of selective audit deletion is definitive. No retained evidence
was removed, no trigger was disabled or bypassed, and no DELETE/TRUNCATE privilege
was added during this follow-up. Applied migrations and application behavior were
not changed. No deploy, automatic commit or push was performed.

The follow-up changes are limited to the two audit scripts and shared read-only
fixture checker, the Bouncer test/isolated runner and provenance helper, its package
command, the narrow runtime-grant revoke, and the related implementation/readiness/
operations documentation. No application routes, storage, authentication or business
workflow code was changed in this follow-up.

### Exact causes

1. Both audit scripts used the same `Object.values(rows).every(v => v === 0)`
   assertion across application identities, operational rows **and** immutable audit,
   reviewer-event and review-decision histories. This asserted global database
   emptiness rather than fixture cleanup and contradicted intentional evidence retention.
2. The first three Bouncer test runs committed `document.download.started` audit
   probes. Their inherited scan cleanup only matched `document.scan.%`, so the three
   download records survived. The database was correctly retaining evidence.
3. The inherited `cleanTestScanRows`/consent teardown also disabled history triggers
   before row deletion. The corrected Bouncer suite no longer imports or executes
   those cleanup paths; it does not selectively delete its histories at all.
4. Fresh provisioning inspection found that `runtime-grants.sql`'s broad SELECT grant
   would include the new `scanner_budget` table. Its explicit scanner-evidence revoke
   now includes that table, matching the intended worker-only boundary. This narrows
   privileges; it adds no role capability or DELETE/TRUNCATE grant. No grant script
   was reapplied to the preserved cluster during this follow-up.

### Changes and enforcement

- `database/test-fixture-audit.ts` provides shared read-only fixture checks for both
  scripts. It scopes live identities/profiles, active grants, submissions/documents,
  pending invitations/notifications and active assignments to established UUID-based
  fixture namespaces, including registration accounts with opaque IDs identified by
  their disposable email address. Ordinary non-fixture application data is not
  required to disappear. Live fixture residue still fails the audit.
- Retained history is counted/reported globally, with no ID/action/count allowlist
  for these three records. For **ten** append-only tables, checks require both actual
  enforcement triggers, their original events/timing, correct rejecting function and
  normal-write enabled state. Application/scanner/notification roles must have no
  UPDATE/DELETE/TRUNCATE capability over those histories. Existing global RLS,
  migration hashes, restricted functions, enabled triggers and artifact checks remain.
- `scripts/db/phase41b-test.ts` now runs `db:test:phase41b` without private env files
  in a fresh marked `/tmp/cape-p41b-test-*` PostgreSQL cluster. It refuses a running
  preserved project cluster; an occupied endpoint prevents startup, never causes an
  existing server to be stopped. Bootstrap verifies the exact fresh data directory;
  the suite checks a protected manifest and per-run database-role marker before writes.
  Production/local connection guards retain the same fixed local endpoint, database,
  ownership/role/marker and privilege requirements.
- The child receives only generated disposable credentials and test configuration,
  with no inherited provider key. All migrations and the existing restricted role
  grants are replayed. No production/user privilege is granted. After connections
  close, the runner verifies its manifest/run ID/data directory again, stops its own
  server, confirms it is stopped, then disposes only that **whole fresh environment**.
  The preserved project cluster and its histories are never used as a reset target.
- New integration cases show nonempty history passes, known live fixture identities
  (including opaque auth IDs) fail, and owner UPDATE/DELETE/TRUNCATE attempts are
  rejected with SQLSTATE `55000`. Before/after row equality proves those attempts do
  not remove or alter evidence. No trigger bypass is needed to test enforcement.

### Follow-up results

| Check                                                         | Observed result                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Isolated Bouncer integration suite                            | 24 passed, 0 failed/skipped; repeated in fresh environments                                |
| Both read-only Phase 3E/3F audits                             | Passed with all three retained audit records and zero live fixture counts                  |
| Original record preservation                                  | All three records have identical full-row JSON digest/count before and after the follow-up |
| Direct suite without isolated provenance                      | Refused before database connection/writes, as expected                                     |
| Runner while preserved project cluster is active              | Refused before creating/resetting a test environment, as expected                          |
| Unit suite                                                    | 49 passed across 12 files                                                                  |
| Typecheck / targeted ESLint / Drizzle check / diff whitespace | Passed                                                                                     |
| Preserved environment                                         | Left stopped, matching its initial state; no row-level history cleanup ran                 |

Local follow-up evidence is in `.local/phase41b-results/isolated-fixture-tests.log`,
`isolated-fixture-tests-repeat.log`, `audit-followup-phase3e.log`,
`audit-followup-phase3f.log`, `isolated-guards.log` and the private preservation digest
snapshot. These are ignored local test artifacts, with no private credential output.

Legacy Phase 3A–4/browser helpers outside this affected suite still contain historical
trigger-disabling teardown code. They were neither invoked nor refactored in this
follow-up; earlier results above retain their original scope. They require their own
isolation/teardown migration before rerunning under the same no-bypass policy. No
application functionality was changed to accommodate testing.

The owner subsequently authorized a local Git commit. That authorization does not
include pushing, merging or deployment.
