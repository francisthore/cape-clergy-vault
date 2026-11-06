# Operations and monitoring foundation

No production service, monitoring account, paid integration, cron job or deployment
is installed. Commands target the existing guarded local database. Preserve separate
operator/worker credentials, capture-only test email and private filesystem ownership.

## Health and diagnostics

`GET /health/live` returns only `{"status":"live"}` while the process can respond;
it has no dependency checks. `GET /health/ready` returns `ready` (200), `degraded`
(200, database/storage available but scanner not ready), or `unavailable` (503,
database/storage failed or dangerously low). Responses use no-store and never expose
component addresses, paths, engine diagnostics, keys, identities or queue contents.
Only GET/HEAD are accepted. Readiness probes are coalesced for 15 seconds; changes
can take that interval plus in-flight bounded probes to appear. Existing clean
resources may remain usable while new uploads cannot promote during degradation.

`bun run operations:report` is a protected terminal command using the guarded owner
connection; it has no HTTP route. It emits aggregate scan/notification/failure counts,
scanner component booleans/categories and free bytes/inodes. Run
`bun run storage:inventory -- --verify` for read-only object/database reconciliation.
Inventory reports exact document IDs only to the operator, never filenames/paths or
contents. Neither command repairs/deletes files. Database-unavailable diagnostics
cannot report fresh DB queue counts; process exit failure itself needs monitoring.

Existing private stream/upload logs use ID/correlation-only categories. The new
operational logger accepts fixed event categories and numeric counts; it excludes
provider errors, raw Error objects and arbitrary payloads. Capture stdout/stderr with
ordinary protected system logging. Limit log access, rotation and retention separately.
Audit commits remain mandatory before bytes. An audit outage blocks downloads;
post-transfer audit failure logs cannot prove recipient receipt.

## Initial actionable thresholds (operational proposals)

| Signal                                            | Investigate/alert                                  | Response                                                                   |
| ------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| queued/scanning job older than 10 minutes         | any, sustained across two reports                  | inspect lease/worker/daemon; preserve quarantine                           |
| stale/missing signatures or scanner probe failure | immediately                                        | stop promotions; repair updater/daemon, verify with safe fixtures          |
| notification queue older than 15 minutes          | any, after configured schedule allowance           | inspect enable settings/worker/provider; preserve stable payload/key       |
| exhausted scan or notification attempts           | any                                                | operator review; no automatic attempt reset                                |
| repeated failed uploads                           | five in an hour, adapt after baseline              | check disk/proxy/validation categories without file contents               |
| private storage free space                        | warning below 1 GiB or 15%; critical below 100 MiB | capacity response; readiness unavailable at critical floor                 |
| free inodes                                       | warning below 10,000 or 10%; critical below 1,000  | investigate temporary/inventory growth; no bulk deletion                   |
| download authorization/audit errors               | repeated burst or any audit-commit outage          | correlate IDs and DB health; retain fail-closed downloads                  |
| DB/object checksum/missing/unknown inventory      | any                                                | stop affected access/writers, reconcile paired backups; never auto-promote |
| missing worker completion                         | no batch completion for two schedule intervals     | alert supervisor failure even if queue empty                               |

These thresholds are starting operational guidance, not automatic paging deployment.
Host logs, updater health, worker last-success and backup restore evidence still need
production collection. SQL queue ages cannot by themselves prove a worker is alive.

## Worker coordination and recovery

| Command                             | Credential                        | Claim/recovery                                             |
| ----------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| `bun run db:notifications`          | restricted notification login     | SKIP LOCKED, five-minute lease, max 20, eight attempts     |
| `bun run db:reviewer:notifications` | restricted notification login     | same bounds, exact assignment check, audited cancellations |
| `bun run db:scans`                  | separate restricted scanner login | SKIP LOCKED + global two-lease cap, max 20, five attempts  |

Choose one supervisor/schedule per command, e.g. a minute-based timer with bounded
invocations and overlap monitoring. Claims tolerate concurrent invocations; do not
assume scheduling alone provides exclusivity. Avoid duplicate PM2/cron/systemd schedules.
No owner worker may run from a web request. Phase 4 supplies the restricted notification login and five reviewed functions;
run `db:notifications:setup` locally, and keep its ignored environment outside web.
Production target-specific provisioning remains separately reviewed; local guards are
retained. See [database roles](production-database-roles.md) and
[supervision](worker-supervision.md). Ordinary multi-UID filesystem sharing is not
supported by the current 0700 owner-checked provider; resolve host namespace isolation
before confidential staging.

After interruption, restart the bounded worker and let expired leases recover. Do not
rebuild queues from submission decisions or modify review outcomes after email failure.
Never reset ambiguous/exhausted email attempts before checking provider evidence;
idempotency retention is finite. A cancellation committed before the final delivery
check prevents send. Revocation after that committed check can race provider submission
or completion; the database and provider do not share an atomic transaction. Provider
acceptance cannot be recalled;
all links still enforce live session/RLS. Inspect immutable cancellation evidence.

Read [scanning](document-scanning.md), [reviewer operations](reviewer-operations.md),
[privacy readiness](privacy-retention-readiness.md), and existing backup/restore and
storage runbooks before release. TLS, shared rate limits, monitoring escalation,
capacity quotas, delivery/DNS checks, backup restore drills and worker supervision
remain required. No unrestricted confidential readiness is claimed.

Phase 4 changes scanner-only degradation to HTTP 200 with `status: degraded`; monitors
must inspect JSON and must not restart healthy Node for daemon outages. Database,
storage and critical-capacity failure remain unavailable/503. See the
[release matrix](release-readiness.md), [backup drill](backup-recovery.md),
[ClamAV pack](clamav-operational-acceptance.md) and [shared limiter](shared-rate-limiting.md).
