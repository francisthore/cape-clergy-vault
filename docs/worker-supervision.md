# Proposed supervision, health and monitoring

No supervisor/service was installed or enabled. See `ops/ecosystem.config.cjs` and
`ops/nginx.conf.example` for review-only web templates. All paths/users/ports are
proposals. Do not apply to existing VPS services without separate authorization.

## Schedule and recovery

| Work             | Entry                                                  | Batch / concurrency                                        | Cadence and recovery                                                             |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Web              | built Node server                                      | initially one process; shared DB limiter supports multiple | auto restart on process exit; dependency failure does not trigger a restart loop |
| Scanner          | `node scripts/worker-loop.mjs scanner`                 | 20 sequential jobs; SQL global cap two live leases         | after each completion wait 60–65 seconds; five attempts; five-minute leases      |
| Approval mail    | `node scripts/worker-loop.mjs approval`                | 20 sequential; SKIP LOCKED                                 | same interval; eight attempts; five-minute leases                                |
| Reviewer mail    | `node scripts/worker-loop.mjs reviewer`                | 20 sequential; SKIP LOCKED                                 | same interval; exact live assignment/invitation checks                           |
| clamd            | separately reviewed native service                     | memory-sized thread count                                  | start before workers; no promotions until healthy                                |
| FreshClam        | one native updater                                     | one updater per signature store                            | supported updater schedule/reload, monitor loaded definitions                    |
| PostgreSQL/Nginx | existing host conventions, dedicated app configuration | approve capacity/isolation first                           | host reboot recovery must be exercised on staging                                |

Do not add cron/timers alongside these loops. Initial batch runs on startup; backlog
continues in bounded batches. Retries use existing available_at/backoff; no busy
polling or request-triggered work. SIGTERM/SIGINT stops scheduling and lets the active
child finish for up to 190 seconds, then terminates it. Use supervisor kill timeout
at least 200 seconds; longer batches can be interrupted safely through leases.
A forced exit during provider acceptance is ambiguous: reconcile provider evidence
before manual action. Never reset exhausted attempts or rebuild intents from decisions.

The wrapper emits structured `worker.cycle` records with kind, correlation UUID,
exit and consecutive failure counts; three consecutive failed invocations flag an
alert. A zero exit alone does not prove delivery: EmailService can record retryable
job failures while a batch completes, so monitor queue ages/exhaustion too. Persist
last cycle completion through restricted log collection; no web diagnostics route.
Use separate service environments/secret mounts, not inherited operator configuration.
Failure recovery preserves queues and business/audit history. Actual host startup,
namespace isolation and service restart acceptance remain Not tested.

## Health contract

`/health/live` is dependency-free, HTTP 200 while Node responds. `/health/ready` now
returns `ready` 200, `degraded` 200 when DB/storage are usable but scanning is down,
or `unavailable` 503 when DB/storage/configuration/critical capacity are unusable.
Only generic status is public, with no-store. Probes coalesce for 15 seconds; scanner
probe has a ten-second deadline. GET/HEAD only. The unit and browser tests cover
scanner outage semantics; upload/SQL promotion remains fail-closed independently.

An HTTP-success-only monitor misses scanning degradation: inspect the readiness JSON
and the protected operations report. Do not restart healthy Node for a scanner outage.
Nginx should continue serving authorized existing clean resources. Missing storage,
database or audit commits blocks affected operations; capacity critical thresholds
remain 100 MiB / 1,000 inodes. This contract supersedes Phase 3F's degraded HTTP 503.

## Proposed alerts and actions

| Signal                        | Threshold                                                        | Action / evidence                                                                        |
| ----------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Web liveness                  | two failed probes 30s apart                                      | inspect web supervisor and safe logs; page named on-call owner                           |
| DB unavailable                | two failed probes / one failed scheduled report                  | preserve intents, investigate dedicated DB, no alternate credentials                     |
| Scanner unavailable/stale     | immediately                                                      | hold quarantine; repair socket/daemon/updater; safe clean/detection checks before resume |
| Scan backlog                  | oldest eligible >10min across two reports                        | inspect lease/concurrency/capacity; do not promote manually                              |
| Notification backlog          | oldest >15min across two reports                                 | check enabled flags, worker, provider evidence and retry schedule                        |
| Exhausted scan/mail           | any                                                              | exact-ID operator investigation; no automatic reset                                      |
| Worker heartbeat              | no cycle completion within batch bound plus two intervals        | inspect loop/supervisor; do not run duplicate schedulers                                 |
| Storage capacity              | <15% or <1GiB warning; <100MiB critical                          | expand dedicated capacity; preserve quarantine and history                               |
| Inodes                        | <10% or <10,000 warning; <1,000 critical                         | investigate inventory/temp growth; no blanket deletion                                   |
| Download audit commit failure | any; denial bursts correlated                                    | block bytes, inspect DB/audit path; preserve transfer correlation IDs                    |
| Backup failure                | missed proposed daily checkpoint or decrypt/manifest check fails | alert operator; preserve last good backup; prohibit unreviewed rotation                  |
| Auth abuse                    | >20 safe denial/429 events per minute sustained 5min (proposal)  | correlate aggregate categories, tune after baseline; no credentials/mailboxes/IP logs    |

Protected `operations:report` supplies queue/capacity/inventory categories. It cannot
prove live external delivery, daemon configuration or backup success. Host CPU/RAM,
filesystem growth, updater reload and log ingestion need real staging measurements.
Retention/rotation and alert recipient/escalation ownership remain pending approval.
No paid integration is required. Logs omit query strings, cookies, proof, provider
payloads, confidential titles and raw DB exceptions; access/retention are restricted.
Auth 429s can be counted from safe reverse-proxy access logs; no fake audit events
claim a delivered alert. The access-log template excludes query/referrer content.

Workers execute the reviewed TypeScript/import tree with Node 24.12+ and locked runtime
dependencies; a web-only `.output` archive is insufficient for these CLI entries.
Package the worker source/dependencies as immutable artifacts with no private environments,
captures or storage. Run from its reviewed release root with only per-worker configuration.
