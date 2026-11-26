# V1 practical deployment decision — PROPOSED

**Status: PROPOSED, not approved. Nothing here declares GO, changes an acceptance criterion, or authorises any host action.** Prepared 26 November 2026 from repository documents only (no VPS access). "Operator-reported" evidence is not held in this repository. Current disposition stays **NO-GO** for staging, installation and launch ([evidence register](phase-5a-evidence-register.md)).

## 0. Framing and corrections adopted

| Correction | How it is applied here |
| --- | --- |
| 1. No destructive OOM or PID-exhaustion tests on real services | Real `cape-vault-*` units and neighbours get **configuration and observation checks only**. The deliberate OOM kill (M2) and pids-limit refusal (M4) exist only inside the capped synthetic probe slice and each needs explicit per-test approval. Otherwise they become signed residual risks (R4). |
| 2. Shared storage UID is a design constraint; keep the launcher; no rewrite | Recorded as residual risk R1. Mitigation is the existing PID/mount-namespace launcher, proven by N1–N5, S1–S6 and C-series. No change to units, launcher or security directives. |
| 3. No bypass of acceptance gates without documented approval | Every relaxation below is a PROPOSED change needing the named approver's signed record. Until signed, the current criteria are in force. |

Terms: **Private installation** = Phase 5B Tier 0, synthetic data only, restricted access, email provider disabled. **Public launch** = real clergy, real data, live providers. Approver roles are placeholders: **Independent reviewer** (neither operator nor author of the workflow), **Host owner**, **DBA**, **Diocesan responsible party**. No individual is identified in the repository and none is assumed.

## 1. Before private installation

Stage: **E** = entry to any host change; **X** = exit of installation, before any synthetic user other than the operator signs in.

| # | Requirement (stage) | Existing evidence | Remaining test or decision | Risk if omitted | Approver | Pass / sign-off condition |
| --- | --- | --- | --- | --- | --- | --- |
| 1.1 | **C1b Path P independent acceptance** (E) | Case 004 (operator-reported, rev `46dc4c5`, systemd 255.4-1ubuntu8.19): setup, bang, runtime, rollback PASS; plus control INCONCLUSIVE. Path P requirements 1–4, 6, 7 met; requirement 5 (credential-parent projection) **partial**; mask causation **unproven** | Reviewer decides Path S / Path P / keep open ([decision sheet §A](phase-5a-review-decision-sheet.md)); decides whether a read-only `/run/credentials` listing is mandatory; reviewer inspects Case 004 evidence directory | Sibling-credential isolation rests on an unattributed denial; if systemd projection changes, the explicit mask may be the only barrier and is untested | Independent reviewer | Signed record: exact version, evidence digest, observations 1–6, each limitation accepted, date. Recorded as *accepted with residual risk*, never "proven". Operator or author self-approval fails |
| 1.2 | **N1–N5 carry-forward** (E) | Passed 25 Nov on rev 4 files, before the `/run` read-only rule and `KillMode=control-group` | Reviewer chooses accept carry-forward or re-run ([§B](phase-5a-review-decision-sheet.md)) | Namespace/PID isolation proven on files that differ from what ships | Independent reviewer | Accept only with a file-level diff of the six probe units against the reviewed bundle showing no change touching N1–N5 behaviour; otherwise re-run N1–N5 |
| 1.3 | **N8 / N8b carry-forward** (E) | N8 pass at 20 s, N8b pass at 40 s, `KillMode=control-group`, 26 Nov, before `/run` rule | Reviewer accepts that `/run` rule does not touch stop semantics ([§C](phase-5a-review-decision-sheet.md)) | Graceful-drain claim untested on current files; forced kill could corrupt in-flight work | Independent reviewer | Accept with written rationale, **and** N8/N8b repeat on the real web unit (1.12) |
| 1.4 | Remaining 5A tests still required: N7, N9, C2+C2c, C7, S1–S3+S3c, A1–A3 (E) | Not run. Local `check-local.sh` and `test:namespace-guard` 8/8 pass | Run under fresh G0/P7, each separately authorised, stop at first mismatch | Credential/object-store isolation and AppArmor interaction unverified on the host | Host owner (authorise), independent reviewer (accept) | Every negative fails with EACCES/ENOENT, every control behaves as predicted (C2c, S3c), X1 clean after each section |
| 1.5 | **Mandatory credential checks** (X) | Local: per-service credential sets, scanner-only Bouncer key, operator mount separate, no secret in env/argv designed. Host: C1a only | C3 (no unit reads another's credentials), C4 (no secret in argv/env/log), C5 (exact sets per unit), C6 (operator credential lifecycle) on **real units**, synthetic secrets | A service reads another's secret, or an owner credential leaks to a service | Independent reviewer | All four pass on real units; no secret in journal, `systemctl show`, `/proc` views; operator mount absent after maintenance |
| 1.6 | **Mandatory object-storage checks** (X) | Local storage tests. Host: none (S1–S3 are probe-only) | S4–S6: real `/var/lib/cape-vault/objects` owner/mode, neighbour-user denial, `namei`/ACL, disk guard; S1 validates web read-write exception | Neighbour or sibling unit reads or alters stored PDFs; disk exhaustion hits neighbours | Independent reviewer, Host owner | Objects 0700 storage UID only; neighbour users denied; scanner read-only; web writes work; disk guard triggers below threshold |
| 1.7 | **Shared VPS neighbour protection** (E, X) | Tier 0 slice proposed (MemoryHigh 512M, MemoryMax 640M, 75% CPU, no swap, TasksMax); `systemd-oomd` inactive; neighbours named; 2.5 GiB available (one snapshot only) | Peak-hour neighbour baseline (several samples); neighbour answer on `kbsk-staging` return; 5B-3 baseline; M1 (controllers present), M3 (CPU throttle), M5 (OOM score) non-destructively; 24–48 h observation (M7–M8) | Our load degrades PM2 apps, Nginx or PostgreSQL | Host owner | Baseline stored; `MemAvailable` ≥ 2.5 GiB gate met before load; no neighbour restart/latency regression; controllers `cpu memory pids` confirmed. **No OOM/PID stress on real units** |
| 1.8 | **Real-unit security and restart verification** (X) | N10, N6 deferred; probe restart only | N6 (broken-launcher wiring with real `service-entry.mjs`); repeat N1–N4 + N8/N8b + S1–S3 on real web unit; restart of each unit (SIGTERM drain, lease recovery); reboot **only** with separate authorisation | Probe results do not transfer to shipped units | Independent reviewer | Same predictions as probe; unit `Result=success` on stop; no extra provider/DB effects after restart. Reboot item: see 3.2 |
| 1.9 | **PostgreSQL 16, migrations, RLS** (X) | 41 migrations (0000–0040), hashes recorded (0039 `38f19e2f…7819`, 0040 `0bb7ff79…fdbaa`); 30 RLS app tables; local rehearsal on **PG 18** disposable cluster; host PG16 online | Migrate on isolated matching PG16 target; 5B-5 roles (NOSUPERUSER/NOBYPASSRLS etc., per-DB login, TCP rejection), 5B-7 `migrate` → `grants` → `check`; note `npm run db:check` does not verify `database/migrations/` | Migration or RLS behaviour differs on PG16; over-privileged role | DBA, Independent reviewer | Full ledger hash match (41), 30 tables with RLS, role/grant/function/immutable-trigger audits pass, other apps' roles cannot connect, neighbours unaffected |
| 1.10 | **Backup, restore and rollback (synthetic)** (X) | `test:recovery` passes locally on two clusters; 5B rollback steps written; Case 004 rollback PASS | Dry-run backup of the empty/synthetic DB + objects; restore into isolated PG16; execute 5B teardown against the 5B-3 inventory | Cannot return host to baseline; restore never proven on this stack | Host owner, DBA | Restore reproduces hashes, ledger, RLS; teardown leaves neighbours, Nginx, PM2 and mounts identical to baseline |
| 1.11 | **Bouncer and Resend disabled** (E, X) | `EMAIL_PROVIDER=disabled`, no Bouncer key, no PDFs in 5B scope | Confirm both absent from all four credential sets; `/health/ready` degraded as expected | Accidental live send or external document transfer | Host owner | No Resend/Bouncer secret on host; no outbound connection to either in logs |
| 1.12 | Authorisation record and approvals (E) | 5B-2 template | Owner records host, tier, window, rollback window, names/paths/ports, access restriction, who may run privileged commands | Unauthorised or ambiguous change | Host owner | Written record naming exact values |

## 2. Before public launch

| # | Requirement | Existing evidence | Remaining test or decision | Risk if omitted | Approver | Pass / sign-off condition |
| --- | --- | --- | --- | --- | --- | --- |
| 2.1 | **Bouncer real small-file acceptance** | Mocked API/DB/restart/quota only; 4 MiB hard limit; confidential route NO-GO | Bounded provider window: synthetic PDFs both classes incl. exactly 4 MiB, one submission per document, receipts, hash/size match; confirm contract, data location, retention. Confidential transfers need a recorded diocesan decision (0040) | Real scanner behaviour, quota and processing approval unknown; unlawful transfer | Diocesan responsible party, Independent reviewer | Window record (scope, hashes, max scans, stop criteria) complete; freeze on ambiguity honoured; confidential stays disabled unless decision recorded and separately reviewed |
| 2.2 | **Resend live deliverability** | Captured email only; outbox leases/payload snapshots tested | SPF/DKIM/DMARC alignment, real received headers/links, bounces, bounded recipient allowlist per message class | Verification/reset mail not delivered or spoofable | Diocesan responsible party, Host owner | Headers and links verified from actual mailboxes; no proof tokens in logs; counts reconciled at window close |
| 2.3 | Off-host backup, timed restore, key custody | Local authenticated-encryption restore passes | Quiesced backup, off-host copy, separate key custody, restore to isolated PG16, measure RPO/RTO, reconcile approval references before scanner start | Unrecoverable evidence; key loss | Diocesan responsible party, DBA | RPO/RTO approved and met; key recovery shown |
| 2.4 | Monitoring and on-call | Local queue/failure thresholds only; no collector or recipient | Trigger safe stale-worker/queue/backup-age alerts; confirm receipt and acknowledgement; incident exercise | Failures unnoticed | Host owner, named on-call | Alert received and acknowledged by named person within agreed time |
| 2.5 | Capacity under all four units | None on host | Load with three batches, 4 MiB upload/scan/download, email burst and backup I/O. Observation only: **no OOM/PID provocation of real services** | Neighbour regression at launch | Host owner | No neighbour latency/error regression; peaks inside budgets; else dedicated host or more capacity |
| 2.6 | Shared rate limits, Nginx trust, 4 MiB through Nginx | Local limiter tests | Exactly 4 MiB accepted, one byte more rejected through real vhost; trusted proxy headers | Abuse or bypass | Host owner | As stated |
| 2.7 | Governance: privacy notice, retention, rights, incident lead, processor terms, prior-transfer investigation (two historic confidential records) | Approval pack and registers; all decisions open | Diocese approval pack signed | Unlawful processing; no accountable owner | Diocesan responsible party | Signed approvals; no compliance claim made before |
| 2.8 | Human browser, mobile, accessibility acceptance | Chromium emulated viewports and axe pass | Physical devices, Safari/Android, assistive technology, HTTPS cookies, post-sign-out cache | Inaccessible or insecure on real devices | Diocesan responsible party | Tester sign-off recorded |
| 2.9 | Independent access authorisers and reviewers named | None identified | Name delegated access manager, coordinator, deputies | Reviewer activation cannot be run independently | Diocesan responsible party | Names recorded; no self-authorisation |
| 2.10 | Exposure and rollback decision | Go-live record all Open | Dated owner decision, accepted residual risks, named rollback operator | Launch without accountable decision | Diocesan responsible party | Signed go/no-go (not given here) |

## 3. Deferrable only with signed residual-risk acceptance

Each needs the named approver's signed, dated entry listing the limitation. Absent that, it reverts to a required item above.

| # | Item | Existing evidence | Residual risk | Compensating control | Approver | Sign-off condition |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | Shared storage UID across web/scanner/reviewer (design constraint) | Launcher with separate PID and mount namespaces; N1–N5, S-series | A namespace escape exposes all stored objects | Keep launcher unchanged; passes of 1.4–1.8; private storage mode 0700; re-assess on any systemd/kernel/distro change | Diocesan responsible party, Independent reviewer | Accepted in writing as a current V1 design limit, with re-architecture noted as future work |
| R2 | C1b accepted via Path P (see 1.1) | See 1.1 | Attribution unproven | Production `-/run/credentials/<sibling>` lines unchanged; reassessment triggers | Independent reviewer | See 1.1 |
| R3 | I/O contention (`IOWeight=20` inert; `system.slice` lacks `io`; I1–I2) | Recorded in decision sheet §D | Backup/restore or heavy I/O slows neighbours | Schedule heavy I/O off-peak; about five users; remove all `IOWeight` protection claims | Host owner | Accept (about five users) or reject (separate VM) in writing |
| R4 | No destructive OOM/PID tests on the host | M1, M3, M5 non-destructive; limits visible in effective config; local reasoning only | Cgroup OOM or pids behaviour unproven on this host; neighbour impact if limits fail | `MemoryMax`, `TasksMax`, `OOMScoreAdjust=500`, `MemorySwapMax=0`; 24–48 h observation; optional synthetic probe-slice test later with explicit approval | Host owner | Written acceptance; or approved synthetic probe-slice M2/M4 |
| R5 | N1–N5, N8/N8b carry-forward (if reviewer accepts) | See 1.2, 1.3 | Earlier-revision results | File diff; repeat on real units (1.8) | Independent reviewer | See 1.2, 1.3 |
| R6 | Host reboot (N10) not exercised | None | Units fail to return or return unsafely after reboot | Units disabled until tested; manual start runbook | Host owner | Reboot test **before public launch**, or signed acceptance for private installation only |
| R7 | Bouncer limited to 4 MiB; confidential PDFs excluded; no ClamAV on shared VPS | Local tests; 0040 gate | Larger/confidential documents unsupported | Hard limits and refusal paths remain | Diocesan responsible party | Stated in launch notice; no confidential readiness claim |
| R8 | Revocation cannot recall transferred bytes; legacy chat/PWA/Google OAuth out of scope | Existing project rules | Residual disclosure after revocation | Documented | Diocesan responsible party | Acknowledged |

## 4. PROPOSED minimum changes to Phase 5A and 5B (not approved)

**Phase 5A** ([host acceptance tests §10](phase-5a-host-acceptance-tests.md), [C1 verification](phase-5a-c1-host-verification.md))

| ID | Change | Why |
| --- | --- | --- |
| P5A-1 | Adopt the already-drafted C1b rule: plus sibling row becomes "recorded, not required"; C1b closed by Path S proven or Path P with the seven requirements and independent sign-off. Add: requirement 5 (read-only `/run/credentials` listing) is mandatory **unless the reviewer records why not** | Plus visibility measures systemd projection, not the sandbox; keeps all bang denials |
| P5A-2 | N1–N5 and N8/N8b carry forward only on a recorded file-level diff plus reviewer acceptance; otherwise re-run (N1–N5 first) | Avoids repeating passed tests without losing revision currency |
| P5A-3 | M2 (OOM kill) and M4 (pids refusal) become **optional, probe-slice only, per-test approval**; GO requires M1, M3, M5 and the R4 acceptance instead. Delete approval-sheet rows 8 and 9 from the default set | Correction 1 |
| P5A-4 | Keep I1–I2 recorded; require the written R3 accept/reject; I3 stays excluded | Already in §10 |
| P5A-5 | Record R1 (shared UID) in the §10 sign-off as an accepted design limit, not a test failure | Correction 2 |
| P5A-6 | Require fresh G0/P7 and the 5B-3-style neighbour record before each new G2 run | Existing rule made explicit |

**Phase 5B** ([staging plan](phase-5b-staging-execution-plan.md))

| ID | Change | Why |
| --- | --- | --- |
| P5B-1 | 5B-0 additionally requires signed rows 1.1–1.3 and the residual-risk entries R1–R5 | Closes the gate ambiguity |
| P5B-2 | 5B-8 adds N8/N8b and C3–C6, S4–S6 as explicit exit criteria before any synthetic user logs in; no OOM/PID provocation of real units | Corrections 1 and 3 |
| P5B-3 | 5B-5/5B-7 add a PG16 isolated-target rehearsal and a synthetic backup/restore dry run before 5B-10 | PG18 is the only local engine tested |
| P5B-4 | State that the 5B-6 "40 migrations pending" validation reads 41 (0000–0040) | Count fix already noted elsewhere |
| P5B-5 | Add launch-gate list 2.1–2.10 as a post-5B checklist; 5B itself stays synthetic, provider-disabled | Separates private installation from launch |

## 5. Unresolved blockers

- No independent reviewer or approvers identified; decision sheet rows A–D blank.
- Case 004 evidence directory not available locally; bundle digest not independently rebuilt.
- Persistent PG16 migration state, peak neighbour load and `kbsk-staging` intent unknown.
- Staging, installation and launch remain **NO-GO**. This document does not change that.
