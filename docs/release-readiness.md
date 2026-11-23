# Release readiness — Phase 4.3.1

For the current four-service V1 release, use the [production readiness assessment](v1-production-readiness.md)
and [deployment runbook](v1-deployment-runbook.md). The V1 maximum is 4 MiB per PDF.
Confidential transfers require a documented decision recorded under migration 0040.

## Phase 4.3.1 readiness record


Assessment: 17 November 2026, Africa/Johannesburg. Repository remediation only; no VPS
inspection/deployment, real delivery or external document processing was authorized.
See [remediation evidence](phase-431-pilot-remediation-report.md), the
[Diocese approval pack](diocese-pilot-approval-pack.md) and
[Phase 5 preflight](phase-5-deployment-preflight.md). Earlier phase reports retain
historical results; their open findings and provisional GO wording are superseded here.

“Passed” describes executed local/disposable evidence. It never closes a real-host or
organizational row. No conditional classification is automatically promoted to GO.

## Current contract

- Source base: `feat/self-hosted-migration` at `1bc8d21af30c85bba608525ee4b1d1ed1167431d`;
  Phase 4.3.1 changes are included in the owner-authorized local remediation commit.
  Earlier email wording, palette, attribution
  and frozen acknowledged privacy text are preserved.
- Repository has 40 forward migrations, latest `0039_pilot_authorization_fences`.
  Read-only persistent inventory verifies all 39 applied hashes including 0038;
  **0039 remains pending**. No persistent migration was applied by remediation.
- Disposable contract: 29 app tables with RLS; four explicit Better Auth exceptions;
  runtime 43 functions/20 reviewed tables, scanner six functions/no tables,
  notifications five functions/no tables; 78 SECURITY DEFINER functions with fixed
  search paths and no PUBLIC execute. Original immutable histories remain protected.
- Bouncer stays the intended candidate; no ClamAV installation on the shared VPS.
  Confidential PDF uploads/new external transfers are blocked. Default operational
  limit is 4 MiB inside the 20 MiB hard boundary. A larger limit requires actual host/
  contract acceptance. Provider acceptance markers/IDs survive restart and recovery. Historical confidential
  Bouncer clean verdicts remain evidence but cannot authorize bytes.
- Two currently confidential development PDF records have provider IDs: restricted
  responsible-party investigation is open. No current exhausted/held records were
  found. No contents/identifiers were disclosed and no provider was contacted.

## Engineering and release gates

| Requirement                                               | Current status                                                      | Evidence / remaining action                                                                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent reviewer activation                           | Passed, disposable                                                  | Self-invitation/old pending self-issued proof denied; mailbox binding, expiry, explicit acceptance and replay/forgery tests; existing grants retained                   |
| Confidential assignments                                  | Passed, disposable                                                  | Different coordinator required; coordinator gains no content access; author self-review denied; exact revision/live eligibility/audit retained                          |
| Non-confidential explicit self-assignment                 | Passed, disposable                                                  | Independently activated reviewer/coordinator; concurrent duplicate and revoked-replay denial                                                                            |
| New confidential external transfer gate                   | Passed, disposable                                                  | 0038 + 0039; claim/reserve/promotion restrictions, committed reservation fence, exclusion and concurrent/stale snapshot regressions                                     |
| Earlier possible transfers                                | Awaiting responsible-office investigation                           | Two records with IDs; preserve evidence, assess synthetic/real data and authorization; no claim that a fix reverses a transfer                                          |
| Persistent DB compatibility                               | Blocked pending owner maintenance                                   | 0038 applied; all 39 hashes match; owner must authorize/apply reviewed 0039, then rerun full read-only audits before the new web workflow                               |
| RLS, grants, immutable histories and direct-write denials | Passed, disposable                                                  | Same contract on fresh development-named and production-named isolated databases; no privilege broadening or trigger bypass                                             |
| Production DB boundary and operator tooling               | Passed locally; host acceptance pending                             | Exact protected target/marker/role checks, Unix/TLS boundary, narrow credential scope, pool sizing and prepared explicit maintenance; no remote connection/provisioning |
| Dependencies                                              | No high/critical advisories; three moderate tooling findings remain | Zod/Seroval patched; Vite/Vitest and compatible transitive patches; scoped overrides and lockfile; detailed deferrals in report                                         |
| Auth/session security                                     | Passed locally                                                      | Stream-bounded 16 KiB auth JSON; eight-hour rolling session, one-hour refresh/reset/verification, secure HTTPS cookies, exact origins and live revocation retained      |
| HTML security / CSP                                       | Passed locally                                                      | Per-render nonce, router hydration/concurrency checks, untrusted inline execution blocked; no unsafe-eval/unrestricted inline scripts; limited inline CSS allowance     |
| Fonts and browser privacy                                 | Passed locally                                                      | Same families self-hosted with licenses; no Google Fonts requests; acknowledged notice version unchanged                                                                |
| Operational PDF limit and guidance                        | Passed locally                                                      | Below/exactly/above 4 MiB and 20 MiB; actual streamed bytes; known limitations rejected before rows/reservations; confidential-specific guidance                        |
| Real Bouncer small-file acceptance                        | Not tested / separate authorization needed                          | Mocked API/DB/restart/quota coverage does not prove real scanner performance or processing approval                                                                     |
| Bouncer v2 destination/live contract                      | Blocked for large PDFs                                              | No actual bucket invented or destination validation relaxed; keep 4 MiB default until approved synthetic acceptance                                                     |
| Confidential PDF processing                               | NO-GO                                                               | No approved route; current application intentionally blocks uploads. Approval alone would still require separately reviewed implementation/acceptance                   |
| Private streaming and browser caches                      | Passed in current local suites                                      | Live RLS, clean evidence and committed authorization/start audits; PWA/private-cache and outbox regression preserved                                                    |
| Notification durability                                   | Passed, disposable                                                  | Transactional intents, captured delivery, snapshots/leases/retries, cancellation/revocation and independent reviewer assignment notices                                 |
| Live email/domain/deliverability                          | Not tested / separate authorization needed                          | Actual DNS/sender/Resend agreement/locations and bounded recipient test window required                                                                                 |
| Shared abuse limits                                       | Existing controls retained and regression tested                    | Shared DB limiter/Origin/bounded JSON; actual Nginx trust, realistic load/fairness and host latency still need staging evidence                                         |
| Backup/recovery                                           | Passed locally; host/off-host acceptance pending                    | Coordinated authenticated encryption/isolated restore, hash/ledger/RLS/history checks, missing/orphan detection, keys and provider markers; no real-data transfer       |
| Storage/process/secret isolation                          | Prepared, not host-tested                                           | Inactive native units; same storage UID in separate PID/mount namespaces; read-only scanner; dedicated mail users; no shared PM2 secret domain                          |
| Worker supervision/restart                                | Local recovery/loop evidence; host test pending                     | Three independent loops, overlap locks, bounded leases/retries; reboot/SIGTERM and effective namespace tests required                                                   |
| Shared VPS resource/capacity                              | Not tested                                                          | Proposed bounded pools and service slice; measure remaining RAM/CPU/disk/inodes before allocating; no host-wide changes authorized                                      |
| Monitoring/log handling                                   | Prepared, not operationally accepted                                | Queue/held/quota/capacity/backup/health/heartbeat thresholds; no deployed collector, alert recipient or exercised on-call escalation                                    |
| Chromium responsiveness/axe                               | Passed: 28/28 in final disposable Chromium run                      | Four viewports; physical devices, Safari/Firefox and human assistive-technology checks remain open                                                                      |
| Privacy/retention/rights/incident governance              | Awaiting Diocese approval                                           | Single approval pack; all decisions open, no adopted retention schedule, processor agreement, effective notice or compliance claim                                      |
| Human access authorizers, on-call and deputies            | Awaiting organizational decision                                    | Need independently authorized reviewer/access/coordination personnel and accountable operational offices                                                                |
| Physical mobile/accessibility acceptance                  | Not tested                                                          | Documented human checklist; assign testers and record evidence before real launch                                                                                       |

## Separate release decisions

**A. Local functional demonstration — CONDITIONAL GO.** Synthetic accounts/documents
and captured/mocked providers only. The disposable acceptance harness demonstrates
this safely without persistent changes. To use the ordinary preserved local database,
the owner must first authorize/apply 0039 and pass the read-only audits; the new web
startup check deliberately refuses that stale contract. Do not start a real-key worker
or demonstrate with existing real information.

**B. Isolated VPS staging — CONDITIONAL GO.** Candidate engineering and templates are
prepared; explicit infrastructure authorization, approved exact target/credentials,
verified systemd/kernel PID/mount isolation (or separately reviewed equivalent), TLS,
resource/storage isolation, migration/grant audits and restore acceptance are unmet.
Use synthetic data and keep external workers disabled until their separately approved
test windows. Staging is not deployed or host-validated by this report.

**C. Real-clergy pilot — NO-GO.** Requires the open Diocese/provider/notice/retention/
rights/incident/backup decisions, prior-transfer investigation, independent personnel,
actual infrastructure/deliverability/provider/recovery/monitoring and human accessibility
acceptance. Confidential PDFs have no approved implemented processing route. Neither
a successful demonstration nor a user checkbox closes these blockers.
