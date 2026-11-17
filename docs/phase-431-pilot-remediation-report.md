# Phase 4.3.1 — MVP pilot blocker remediation

17 November 2026, Africa/Johannesburg. Engineering/security review; no release approval.

## Revision, starting state and boundaries

Branch: `feat/self-hosted-migration`. Exact starting revision:
`1bc8d21af30c85bba608525ee4b1d1ed1167431d` (pushed Phase 4.3 audit). Starting tree
was clean. The owner subsequently authorized a local commit containing this report
and the Phase 4.3.1 changes. No push, merge, rebase, history rewrite, VPS access or
deployment was authorized or performed.
Michael's attribution, existing email wording/palette and acknowledged notice text
are preserved. No other application's files, database or services were changed.

Read the requested audit/readiness/4.2.2, administration, infrastructure/roles,
workers/scanning, privacy drafts/registers, recovery, package/lock/journal and affected
code/tests. Node v24.12.0 and Bun 1.4.4 are installed. Tests use protected disposable
clusters, synthetic accounts/PDFs, capture or mocked transports. No real Bouncer API,
Resend delivery, paid plan, real-data export or ClamAV installation ran.

Confirmed starting findings:

- Unlike the old audit snapshot, persistent migration 0038 **was already applied**.
  Final read-only inventory verifies every one of its 39 applied hashes in order.
- The pre-change `manage_access` allowed self-invitation and `coordinate_assignment`
  allowed confidential self-assignment. The policy is now explicitly independent.
- 0038 blocked new confidential claim/reserve, but did not fence a confidentiality
  change after reservation committed and before provider I/O. This race needed a
  forward change, not an edit to 0038.
- Current inventory found **two currently confidential PDF records with provider IDs**.
  That is potential previous external-transfer evidence. It does not establish real
  versus synthetic data, classification at the time or an authorization/incident
  conclusion. Evidence was preserved; only aggregates were output. Responsible-party/
  Information Officer investigation is required. No fix reverses transferred bytes.
- No current held/exhausted records were found. Historical reports are retained;
  this observation does not erase or explain earlier holds.
- Fresh `bun audit --json`: 31 advisories, 13 high / 14 moderate / four low / zero
  critical. Runtime Zod/Seroval and compatible tooling patches were required.
- HTML lacked CSP; lifetimes relied partly on defaults; DB factories had only the
  guarded local target; proposed host isolation/recovery/approvals were not live.

## Implemented security and release changes

### Confidential screening and independent authority

New forward-only migration **0039_pilot_authorization_fences.sql**, journal entry
and schema snapshot. SHA-256 of reviewed SQL:
`38f19e2fca2d22fb8aead72b699697c90b287df8d0133ad8bd6d3f7e2f487819`.
No earlier migration/snapshot or applied ledger was edited.

- Managers cannot invite, grant or revoke themselves. Reviewer status still requires
  another authorized issuer, one-hour exact-mailbox proof and authenticated explicit
  acceptance. Pending historical self-issued proof cannot activate a role. Existing
  accepted grants and assignments are retained; no automatic revocation is invented.
- Another author’s non-confidential revision can be explicitly self-assigned by an
  independently activated reviewer/coordinator. Confidential self-assignment is denied
  before idempotency replay; another authorized coordinator can assign an eligible
  reviewer without acquiring content access. Author self-review is always denied.
- Existing exact-revision/version, live eligibility, replay/concurrency, unique active
  assignment, append-only event/audit and notification intent paths remain unchanged.
- Reservation now takes/writes an identity-only parent-row fence. A trigger rejects
  false-to-true confidentiality changes after any external submission intent/ID,
  including excluded historical attachments. The parent write makes stale
  repeatable-read snapshots fail serialization rather than miss the marker. No
  status/metadata privilege is broadened; no DB transaction spans provider I/O.
- A historical confidential Bouncer clean verdict remains provider evidence but
  cannot authorize bytes: `document_is_clean` rejects that combination, so submission
  and both download authorization/start-audit checks fail closed without erasing history.
- 0038 remains the claim/reserve confidential gate. Already accepted IDs can reconcile
  by polling without re-uploading; missing-ID submission markers become ambiguous,
  never automatically fresh submissions. Unknown/failed/excluded/stale/ineligible
  evidence never establishes clean bytes. Alternate upload, amendment, exclusion,
  cancellation, provider switching, finalization/promotion and download paths were
  reviewed alongside existing scanner regressions. A trusted compromised scanner/OS
  remains outside the honest-worker boundary; SQL cannot recall prior transfers.

UI identity lookup reports whether it is the caller; self-invitation is disabled
and explained. Confidential intake disables the caller’s reviewer option and explains
the second-coordinator requirement. Direct HTTP restrictions and real-cookie tests
repeat the SQL authority. AGENTS and operator/admin guidance now agree with this policy.
The optional P2 shortcut was deferred while external release gates remain open.

### Operational PDF behavior

`CAPE_SCREENING_MAX_BYTES` is trusted server configuration, default **4,194,304 bytes**,
never above the hard **20,971,520-byte** boundary. The API projects only operational
metadata to the UI, with no provider host/credentials. Selection guidance and server
checks agree; both Content-Length and actual streamed bytes are bounded. Confidential
PDF upload is refused independently of the configured numeric limit. Known blocked
attempts create no upload rows or external quota reservations. HTTP 409
`screening_unavailable` distinguishes a processing limitation from invalid PDF bytes
or a malware verdict. No client field raises the server limit.

The worker checks known destination/size configuration before reading/hashing a new
object or reserving quota. The v2 implementation retains exact host/path/scan-ID
validation, HTTPS/no redirects, bounded JSON, neutral filename, temporary credentials
only in memory, streaming multipart, hash/size checks, durable IDs before upload,
leases/restart polling and conservative quota accounting. Bouncer's
[official reference](https://usebouncer.dev/docs/) was re-read; it still supplies a
placeholder bucket. **No actual host or live v2 contract was verified.** No destination
validation was loosened or S3 hostname invented. Large-file acceptance remains a gate.

[Maintenance](pilot-security-maintenance.md) provides a privacy-preserving inventory
and held-job decision procedure. There is no automatic reset/requeue, ambiguity
resubmission or quota refund. A conclusively unattempted hold can be deliberately
replaced through normal author workflow only after operator review; evidence remains.
Provider exactly-once submission/billing is not promised without an idempotency contract.

### Auth, headers and browser assets

Authentication's former size check ran after `request.text()` buffered the body.
It now uses the common bounded JSON reader with a strict streamed 16 KiB cap,
including missing/false Content-Length, early rejection of excessive declarations
and cancellation before further buffering. Other JSON APIs keep their 32 KiB bound.
The unit stream never ends but is cancelled at the boundary; authenticated HTTP
regression verifies 413 without Content-Length and 415 for non-JSON auth input.

Session expiry is explicitly eight hours, rolling on a one-hour update interval;
reset and verification expiry are one hour. Cookie cache stays disabled. HTTPS secure,
HttpOnly, SameSite Lax cookies, exact trusted origin, callback restrictions, reset
session revocation and live capability/session checks remain in force.

Production HTML uses a fresh cryptographic nonce in request-local AsyncLocalStorage
and the actual TanStack router SSR option. The client recovers the framework nonce
meta tag. CSP denies framing, objects, base overrides, foreign connections/scripts
and inline event handlers; scripts use nonce/strict-dynamic without unsafe-eval or
unsafe-inline. Inline **CSS** remains allowed for existing component styles; that is
an explicit, narrower residual style-injection risk, not script permission. Strict-
dynamic trusts scripts created by already trusted JS; the attack regression injects
untrusted HTML before parsing. Zod's supported non-eval mode is configured **before**
StartClient/schema imports, avoiding its otherwise blocked optional Function probe.

App headers cover early denied/error/protected responses and preserve the stricter
PDF sandbox. Protected/nonce HTML is no-store and varies on cookies as appropriate.
Nginx retains vhost-only HSTS without includeSubDomains/preload. No host header change
was applied. The same Karla/Cormorant Garamond families are self-hosted with licenses;
Google Fonts requests are removed. Frozen acknowledgement wording/version is unchanged;
privacy draft factual corrections are explicitly routed to notice review.

### Production boundary, services and recovery

A separate opt-in production factory validates a root-owned exact target file,
dedicated DB/owner/installation marker, fixed role, unsafe attributes/memberships,
ownership, verified TLS for TCP or the fixed protected Unix socket, and catalog security
contract. Local connection guards remain unchanged. Services cannot receive owner URLs
or another unit's credential file. Auth/health share a two-connection runtime pool;
workers have two each (one reserved scheduling lock), operator one temporarily.
Read-only/explicit TTY-confirmed production maintenance is prepared; grants render
the existing reviewed sources with only the fixed production database name changed.
No provisioning, maintenance mutation or remote connection was performed.

Web and worker service connections refuse a missing 0039 security contract. Native
systemd templates use isolated PID/mount namespaces with shared storage UID only for
web/scanner, read-only scanner mount/adapter, separate mail UIDs, private credential
mounts, immutable releases, a bounded resource slice and dedicated runtime lock paths.
The launcher fails unless it is unprivileged PID 1 and replaces itself with Node
24 execve (experimental; host acceptance required), avoiding resident setup wrappers; systemd 257+/kernel support and
actual mount/credential denials require host validation. There is no silent shared-UID
PM2 fallback. App-specific HBA rules must also deny these identities' connections to
other databases, without changing other apps' database ACLs. No ClamAV is proposed.

Explicit `EMAIL_PROVIDER=disabled` supports isolated synthetic staging without Resend
credentials: no network, capture or successful delivery; verification/reset still fail
unavailable and verified-account checks remain. Initial templates use this mode with
mail loops stopped. A separately approved Resend credential drop-in and verified
sender settings are required for delivery. Existing capture/Resend transports,
transactional outboxes, stable snapshots, leases and bounded retries are preserved.

The encrypted disposable drill now also preserves accepted Bouncer IDs, ambiguous
markers and a pending encrypted invitation across restore; correct-key digest recovery
and wrong-key rejection are checked without printing proof. Existing consistent
DB/files snapshots, authenticated encryption, ledger/hash inventory, immutable audit,
RLS and worker recovery checks remain. Off-host destination/key custody/retention,
actual host restoration and measured recovery targets are still unapproved/untested.
Daily backup, 24h RPO and one-business-day RTO are proposals only.

## Dependency advisory status

Compatible fixes: Zod 3.25.76 / nested 4.6.5 → **4.6.7** (one justified major change);
Seroval 1.6.8 → **1.6.11**; Vite 8.1.5 → **8.1.7**; Vitest 4.1.11 → **4.1.12**;
js-yaml 4.3.0 → 4.3.2; nanoid 3.3.16 → 3.3.20; source-map-js 1.2.1 → 1.2.2;
fast-uri 3.1.8 → 3.1.9; serialize-javascript 7.1.2 → 7.1.4; scoped brace-expansion
1.1.16 → 1.1.22 and 5.0.8 → 5.0.13. Package constraints and bun.lock changed together.
TanStack, Better Auth, Drizzle, Nitro and React major versions were not changed.
Bun 1.4.4+ is pinned as the floor for scoped-override lockfile support.

Current audit: **three moderate, zero high/critical/low**. No unresolved high-severity
advisory requires an exception. The runtime validation/serialization concerns were
patched rather than dismissed based on request caps or assumed type reachability.

| Remaining advisory / installed version                                                      | Scope and reachability assessment                                                                                                                     | Available fix / reason deferred                                                                                  | Controls / staging and pilot effect                                                                                                    |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| esbuild 0.18.20 — [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)  | Nested Drizzle Kit legacy esbuild-kit tooling. Affected development server is not used by built web/worker entries; no app route invokes it           | >=0.25.0; legacy loader requires ~0.18.20. Avoid incompatible global substitution/tool migration in this release | Keep tooling/dev servers private/off serving hosts; immutable build artifacts. Does not independently block synthetic staging or pilot |
| glob 11.1.0 — [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)      | Workbox build traversal via vite-plugin-pwa; no request-supplied globs in active web/workers                                                          | >=14.0.2 (current latest 14.0.6); Workbox requires ^11.0.1. Defer multi-major API override                       | Build trusted source in isolation, bounded process resources; never serve build tooling. Does not independently block staging/pilot    |
| minimatch 10.2.6 — [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | ESLint/TypeScript tooling and Workbox's glob; older 3.1.5/5.1.9 installations are outside this advisory's range. No active request-pattern path found | >=11.0.1 (latest 11.0.9); parents require ^10.x. Defer incompatible major override                               | Fixed trusted build/lint patterns and isolated bounded tooling; no public dev server. Does not independently block staging/pilot       |

The generated server dependency trace has only tslib externalized; worker source
imports were inspected for tooling paths. “Build/dev” here describes actual usage,
not merely the dependency/devDependency label (PWA tooling is listed in dependencies).
This is a bounded reachability review, not proof against arbitrary future code paths.

## Tests and actual outcomes

Final command results are recorded below; only executed results count. Disposable
source copies use a separate endpoint and generated marker/credentials, never inherited
private environments. Whole clusters are disposed; no evidence cleanup/trigger bypass.

| Executed check                                                            | Exact final result                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                       | Exit 0                                                                                                                                                                                                                     |
| `npm run lint`                                                            | Exit 0; zero errors, two existing React fast-refresh warnings (`submission-utils.tsx`, legacy `dashboard.tsx`)                                                                                                             |
| `npm run test`                                                            | Exit 0; 20 files, 129 tests passed                                                                                                                                                                                         |
| `npm run build`                                                           | Exit 0; Node production output and guarded generateSW build                                                                                                                                                                |
| `npm run test:phase43`                                                    | Exit 0; 13 Phase 4.3 + 13 Phase 4.3.1 reported tests passed (26 total), including two isolated DB targets and final confidential-byte gate                                                                                 |
| `npm run test:phase422`                                                   | Exit 0; Bouncer/scanner DB 24/24, registration/notification 13/13, owner verification 6/6, administration 12/12; Chromium 28/28 at 320/390/768/1440 px with existing axe checks plus CSP probes (3.7 minutes browser time) |
| `npm run test:bouncer`                                                    | Exit 0; 9/9 passed; only mocked provider calls                                                                                                                                                                             |
| `npm run test:scanner`                                                    | Exit 0; 14 passed, one installed-ClamAV test skipped because no socket/service exists; mock Unix-socket tests ran                                                                                                          |
| `npm run test:recovery`                                                   | Exit 0; encrypted coordinated backup/isolated restore, ledger/object/history checks, lease recovery, Bouncer markers and correct/wrong invitation keys                                                                     |
| `npm run db:test:unit`                                                    | Exit 0; 3/3 local target guard tests                                                                                                                                                                                       |
| `npm run test:dev`                                                        | Exit 0; 6/6 launcher, credential separation, overlap and shutdown/failure tests; no real worker started                                                                                                                    |
| `npm run db:check`                                                        | Exit 0; migration snapshot/journal consistency verified                                                                                                                                                                    |
| `node --check` on service entry / worker loop                             | Exit 0; syntax only. Actual production execve/PID/mount behavior remains host acceptance                                                                                                                                   |
| `bun install --frozen-lockfile --offline --ignore-scripts --no-env-file`  | Exit 0; no dependency/lockfile changes                                                                                                                                                                                     |
| Fresh `bun audit --json`                                                  | Exit 1 because three moderate advisories remain; zero high/critical/low; deferrals above                                                                                                                                   |
| Browser credential/server-code scan                                       | Passed; 81 current browser artifacts, five pattern classes, 11 configured secret values checked without printing values                                                                                                    |
| Tracked migration/environment preservation                                | Every previously tracked SQL/snapshot equals HEAD; only `.env.example` tracked                                                                                                                                             |
| `npm run db:pilot:inventory` (persistent, read-only)                      | Exit 0; all 39 applied hashes verified, only 0039 pending; 0038 gate present, new classification fence absent; two possible earlier transfers, zero held records                                                           |
| Persistent catalog-only role/RLS/grant/function audit                     | Exit 0; 29 app tables with RLS, 43/6/5 execute sets, reviewed runtime tables, no worker table privileges, 77 existing definers with fixed paths/no PUBLIC execute                                                          |
| `npm run db:audit:phase3e` and `db:audit:phase3f` (persistent, read-only) | Both exit 1 **as expected, not Passed**: 39 applied versus 40 reviewed migrations. Owner-authorized 0039 is still required; no workaround applied                                                                          |

A requested final repeat of the read-only persistent inventory was **not executed**:
automatic approval review could not complete because of a usage limit (not a finding
that the query was unsafe). The earlier successful read-only inventory above is the
retained evidence. No persistent mutation was attempted or performed.

Protected final logs and aggregate inventory/audit evidence are retained in
`.local/phase431-results-4mb_kbxo/` (0700 directory, 0600 files, ignored by Git). No email capture,
proof, key, backup archive or real document is included. The current disposable
browser report/screenshots also remain under `.local/phase42-results/`.

Intermediate failures were resolved and rerun: a fixture left a live scan lease;
new TypeScript/index-access and formatting issues; CSP context initially did not stamp
router scripts; cloning Nitro's wrapped Request was invalid; Zod's optional eval probe;
old UI acceptance expected a now-blocked 20 MiB selection; Playwright's generic disabled
matcher did not recognize a native disabled option; a CSP test incorrectly modeled
injection through already trusted JS. The final tests preserve actual authority and
limits, use native option properties and parser-inserted HTML, and do not relax CSP. The expanded browser traffic is
paced through real rate-limit expiry; no counter reset or limit increase is used.

Limits: no live provider request, remote DB, host namespace/credential/TLS exercise,
VPS load/reboot, real off-host transfer or human device/screen-reader acceptance.
Legacy direct `db:test:*` suites that contain trigger-disabling row cleanup were not
executed against the persistent DB; the current disposable security/HTTP/browser suites
cover the affected boundaries without that prohibited cleanup. Historical test results
are not presented as this phase's execution.

## Outstanding decisions and release classifications

Owner action: review/authorize migration 0039 and the exact
[maintenance procedure](pilot-security-maintenance.md), back up/quiesce, apply only the
reviewed pending migration, then rerun full read-only audits before the ordinary local
preview or any real-key worker. Current inventory is read-only and the persistent
contract intentionally remains behind. Preserve the two prior-transfer records and
route restricted investigation to the responsible office; do not expose their contents.

Infrastructure action: explicitly authorize the exact synthetic staging host/scope,
then perform every target/TLS/credential/PID/mount/storage/capacity/grant/backup/restart/
monitoring acceptance in [Phase 5 preflight](phase-5-deployment-preflight.md). Templates
have non-secret placeholders and are not installed. No actual free-capacity or
performance claim is made. Authorize provider test windows separately; no paid plan.

Diocese action: all rows in the single [approval pack](diocese-pilot-approval-pack.md)
remain open: responsible party/contact/mandate, religious/ordinary information grounds,
final notice and cutover, independent people, Bouncer/Resend/hosting/transfer agreements,
prior-transfer investigation, retention/holds, rights, incidents, backup custodians/
targets, support/quotas and human acceptance. Software tests cannot grant approval.

- **A — Local functional demonstration: CONDITIONAL GO.** Disposable synthetic
  acceptance is supported; ordinary preserved-local-DB use first needs owner-approved
  0039 and read-only audits. Use synthetic accounts/PDFs and mocked/captured providers;
  never start real-key workers or use existing real information merely for a demo.
- **B — Isolated VPS staging: CONDITIONAL GO.** Candidate code/templates are prepared;
  explicit infrastructure authorization and all exact target, TLS/credentials,
  namespace/storage/resource, migration/grant, restoration and restart acceptance
  remain unmet. Initial disabled-mail, no-scanner staging is limited to deliberately
  provisioned synthetic accounts/ideas; full PDF/mail acceptance needs separate windows.
- **C — Real-clergy pilot: NO-GO.** Diocese/provider/notice/retention/incident/rights/
  backup approvals, prior-transfer investigation, independent personnel, actual
  infrastructure/provider/deliverability/monitoring/recovery and human acceptance
  remain blockers. Confidential PDFs have no approved implemented route. No checkbox,
  demonstration or conditional staging result changes this classification.
