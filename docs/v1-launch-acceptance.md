# V1 launch acceptance

**Decision as of 23 November 2026: hold launch.** The results below were obtained with disposable accounts, locally generated PDFs, captured email and mocked scanner responses. The live-window and host columns remain open. Keep the signed working copy in the diocesan release record.

## Candidate and reproducible evidence

| Check | Actual local result |
| --- | --- |
| Build and archive | Linux x86-64, Node 24.12.0. Production build, standalone worker/operator imports and archive creation passed. The extracted archive's manifest, member permissions, private-path exclusions, loopback liveness and bundled font passed. Record the accepted release digest again at installation. |
| Migration and roles | `npm run db:check` passed. `npm run test:phase43` passed both Node test runs, 13 and 14 tests respectively including suite parents. Verified ledger through 0040, RLS on 30 app tables, exactly scoped functions, protected histories and no PUBLIC execute. Rehearsed 0039 → 0040 with a pre-existing confidential 5,000,000-byte clean verdict. Its evidence survived and its access predicate remained false after recording a synthetic approval. |
| Unit and static checks | `npm test` passed 129 tests across 20 files. TypeScript passed. ESLint had zero errors and two existing Fast Refresh warnings in unchanged files. |
| Bouncer and worker regressions | `npm run test:bouncer` passed eight. `npm run test:scanner` passed 14 with the optional installed-ClamAV test skipped. `npm run test:dev` passed six. Local doubles supplied all scan and delivery responses. |
| SQL/HTTP and browsers | `npm run test:phase42` passed its four database runs (24, 13, 6, 12 including suite parents). Playwright passed 32 tests across 320, 390, 768 and 1,440 pixel Chromium viewports. These are emulated viewports. |
| Recovery | `npm run test:recovery` passed on two fresh Unix-socket clusters. Copied objects and DB restored together. Wrong key, tampering, missing/orphan objects and migration mismatch were detected. Recovered leases, provider IDs and invitation ciphertext retained their meaning. A withdrawn decision stayed withdrawn, its prior clean confidential document stayed private and the aggregate monitoring SQL ran on the restored database. |
| Systemd preparation | `npm run test:namespace-guard` and `sh ops/host-probe/check-local.sh` passed. Host results as of 26 November (operator-reported, see the [evidence register](phase-5a-evidence-register.md)): G1/G1b, N1–N5 (earlier revision), N8/N8b and C1a observed; C1b, load, I/O, remaining isolation and reboot results are **not complete**. The 23 November local results in this table are unchanged. |

Migration 0040 SHA-256 is `0bb7ff79e2fdcf86cd94f12e342814c37987226b75500626ac88ad13ec1fdbaa`. The locally smoke-tested archive is `cape-vault-v1-uOnNLlQO.tar.gz`, SHA-256 `cb16df1087ab57a11dfee4dffeb3115aec6740d5632558cf8717eb8d568d29ad`. The package and checksum are in the workspace's private `.local/releases/` directory. PostgreSQL 18 supplied the disposable cluster binaries here. Repeat the migration and paired recovery with PostgreSQL 16 on an isolated matching target.

The harness writes aggregate reports under `.local/phase42-results/` and `.local/phase4-recovery-result.json`. Traces, screenshots, email captures and raw provider evidence belong in restricted storage. Early runs exposed a missing explicit revoke in the runtime grant script and sandbox restrictions on local sockets. The revoke was corrected and the isolated suites were rerun with local socket access.

## Workflow matrix

Every target-host or external result in the last column is **not run**. For each executed row, record release and migration hashes, UTC or SAST time, environment, operator, observed result and safe evidence reference. Record failure, blocker or skip explicitly. Name the approver, corrective action and retest result before closing a failure.

| Area | Actual local evidence | Target or provider acceptance still required |
| --- | --- | --- |
| Registration and verification | Passed. Captured verification link, pending account, current notice and verified-email requirement exercised. | Send to an approved synthetic mailbox, verify origin and expiry, record inbox and session state. |
| Clergy approval and rejection | Passed. Independent approver, approval/rejection, suspend/reactivate, cancellation and failed delivery covered. | Walk both paths with separate test identities, verify correct minimal mail and recipient. |
| Password reset | Passed. Used a captured reset, changed password, invalidated sessions, refused token reuse, signed in with new password. | Deliver one bounded reset to the approved mailbox, verify old sign-in fails and link contents stay out of logs. |
| Reviewer invitations | Passed. Separate issuer, exact ID/mailbox, one-hour proof, acceptance, revocation and self-invitation denial. | Capture expiry, correct mailbox and authenticated acceptance with synthetic recipients. |
| Assignments and decisions | Passed. Independent confidential assignment, exact revision, revocation/amendment and review/return/accept flows. Private notes excluded from author feedback and notices. | Walk coordinator, author, assigned and unassigned reviewer accounts. Confirm review decision and notification histories agree. |
| Ordinary PDF | Passed. Below/exactly/above 4 MiB, no length and false small length, browser selection, quarantine and verified download. Repeated uploads to one draft preserved. | Through Nginx, upload exactly 4 MiB and reject one byte more. Submit a synthetic accepted resource and retrieve its eligible repository PDF. |
| Confidential PDF | Passed. Default refusal, explicit synthetic approval, quarantine, mock Bouncer POST and poll, exact-byte owner download, private accepted resource. | In the authorised window, upload a newly created synthetic confidential PDF and verify its decision reference, receipt, reported and local hashes and byte sizes. |
| Failure, quota and withdrawal | Passed. Held/ambiguous response, lease loss, mismatched digest, quota exhaustion and refusal after approval withdrawn between claim and reservation. | Confirm real free-tier limits with the provider. Use a mock for exhaustion or a provider-approved test facility. Never consume the account quota to demonstrate a boundary. |
| Private access and publication | Passed. Unrelated approver denied download, unassigned reviewer denied resource access. Confidential repository detail unavailable even to author after acceptance. Ordinary accepted resources are eligible. | Check search counts, metadata, download URL, private response headers and live reviewer revocation with separate browsers. |
| Audit and migration integrity | Passed. Pre-byte authorisation/start audits required, immutable histories and role permissions verified, known historical verdict held across upgrade. | Compare real PG16 ledger, restricted inventory and audit sequence. Preserve historic provider IDs and investigate separately. |
| Resend | Passed with captures and simulated errors. Outbox leases, stable payloads and retry keys verified. **Live delivery untested.** | Verify SPF/DKIM/DMARC and sender alignment, actual received headers and links, provider receipt, delays and bounce handling. |
| Restart and recovery | Passed in disposable DB and supervisor suites. Recoverable IDs resume polling, unknown submission remains held, leases recover. | Terminate each of the four isolated units during controlled work, confirm drain or lease recovery, no extra provider POST/delivery, and neighbour stability. Repeat authorised host reboot. |
| Browser security and accessibility | Passed Chromium viewport journeys, CSP checks, cookie/session checks, private streaming and automated accessibility assertions. | Test HTTPS cookies, mobile Safari and Android, actual assistive technology, keyboard flow, client cache after sign-out and shared-device access. Obtain human sign-off. |
| Backup and isolated restore | Passed local authenticated encryption/decryption, matching pairs, integrity failures, preserved evidence and restricted-role recovery. | Back up a quiesced target, verify off-host custody, restore into an isolated PG16 installation, demonstrate key recovery and measure RPO/RTO. Reconcile restored approval references against current decisions before any scanner start. |
| Monitoring and incidents | Local queue/failure paths and supervisor escalation passed. On-call delivery and incident exercise unexecuted. | Trigger safe stale-worker/queue and backup-age alerts, record actual receipt/acknowledgement, contain a synthetic disclosure and rehearse controlled restart. |
| Host capacity and isolation | Local launcher/harness checks passed. No target measurement. | Complete G0–G3 and the deferred real-unit tests. Record all four units and simultaneous child loads, swap, latencies and rollback evidence. |

## Separate provider-window approvals

Before any live test, record the provider account, processing approval reference and scope, UTC start/end, operator and observer, named synthetic recipients, approved file hashes/sizes, exact message classes, maximum sends/scans, current usage, stop criteria and who can withdraw access. Isolate the test queue and restrict ingress. Verify contract, location and retention evidence independently of a successful API call.

For Bouncer use harmless synthetic PDFs for both classifications including the 4 MiB boundary, check one provider submission per document, retain safe receipt references and freeze on ambiguity, unexpected quota, hash or recipient. For Resend test verification, reset, registration outcome, reviewer invitation and assignment using the approved sender and recipient allowlist for the window. Inspect actual mailbox receipt. Keep proof-bearing links, cookies, message bodies, PDFs and API keys out of the release record. At window close stop new test work, reconcile observed counts and decide each gate independently.

## Go-live record

| Gate | Required sign-off evidence | Current disposition |
| --- | --- | --- |
| Responsible-party approval | Service ownership, processing/transfer safeguards, notice and acknowledgement decision, retention, subject rights, incident lead, hosting/backups | Open |
| Candidate and target | Exact release digest, PG16 ledger, role audits, Node 24 checksum, effective four-unit configuration and host probe record | Local candidate verified. Host open (Phase 5A partial; see register) |
| Operations | Measured capacity and healthy neighbours, off-host backup and timed restore, on-call alert exercise, support and deputy contacts | Open |
| Providers and users | Approved bounded test windows with actual results, human accessibility/device review, approved communications | Open |
| Exposure and rollback | Dated owner decision, actual approver, accepted residual risks, named rollback operator and maintenance window | Open |

The owner records a go/no-go decision only after reviewing these rows. Keep the dated evidence with the [privacy approvals](privacy-approval-register.md) and follow the [deployment sequence](v1-deployment-runbook.md).
