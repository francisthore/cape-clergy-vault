# Registration notifications and local diagnosis

Phase 4.2 extends the existing approval outbox, EmailService and restricted worker.
It does not send mail from the approval transaction or install a scheduler.

A newly verified pending registration queues one `pending` acknowledgement. In the
same transaction it queues `registration_pending_alert` for each currently verified,
approved identity holding an unrevoked approver capability. Admin addresses and
settings managers are not recipients merely because of those capabilities. The
alert contains no applicant name, email, parish, reason or document details; its
link opens `/admin/registrations`, whose live authorization remains independent.
The dashboard is the source of truth. Multiple applications may be processed before
a queued alert arrives. The event/recipient key prevents repeated verification,
profile recovery or retry from duplicating alerts. No historical backfill runs.
Zero recipients records `registration.approver_alert_no_recipients` in immutable
audit history. It neither guesses a recipient nor retries fanout when a new approver
is appointed. The operator must monitor the actual pending dashboard.

Before each delivery, live verification, approval, approver grant and any captured
mailbox are rechecked. Revoked or changed recipients are cancelled with evidence.
The common outbox retains SKIP LOCKED claims, five-minute leases, eight bounded
attempts, stable sender/recipient snapshots, stable provider idempotency keys and
backoff. Queue writes commit with business decisions; provider calls follow commit.
Approval, neutral rejection, suspension and reactivation continue to use the existing
atomic decision function. Internal decision reasons are absent from the templates.

## Safe local workflow

Use `npm run test:phase42` for repeatable end-to-end development. It copies an explicit
source allowlist into a private `/tmp/cape-p42-source-*` directory, excludes private
environments/credentials/storage, builds in production mode and creates an entirely
fresh marked PostgreSQL cluster on **55433**. Only that copy changes the fixed test
port; the real application's 55432 guards remain unchanged. All migrations and
restricted grants replay. Synthetic identities, captured email and mocked Bouncer
responses exercise the actual built HTTP application in Chromium at localhost:3220.
History triggers stay enabled. Disposal removes the whole verified fresh cluster;
there is no history-row teardown. Ports must be free; no existing listener is stopped.
Results are copied to `.local/phase42-results/` (private, ignored).

For a running guarded local application, `npm run db:notifications:status` performs
only a read-only aggregate inspection: kinds/states/counts, maximum attempts, oldest
age, sender enable flags, domain authorization and active worker connections. It
prints no addresses, payloads, credentials or proof. A zero connection count cannot
establish whether a supervised worker exists or is between cycles.

`bun run db:notifications` / `npm run db:notifications` remains the existing bounded
batch entry. **It can send real mail using the configured environment and drain
existing queued recipients. Do not use it as an automated test.** Switching a real
queue to capture would mark real intents complete without recipient delivery, so do
not do that either. Tests use disposable databases. Live acceptance requires separate
explicit authorization of exact controlled recipients, message types/counts and time
window. None was performed in Phase 4.2.

## Diagnose an outcome that did not arrive

1. Confirm the registration decision succeeded in the dashboard and immutable history.
   A failed or rolled-back decision must have no intent. Repeated request IDs return
   the same committed result; do not rebuild intents from history.
2. Inspect aggregate queue status. A queued/due intent needs the separate worker.
   `retry_wait`, a live lease or exhausted attempts explain why it is not claimable.
3. Check the supervised worker cycle evidence and backlog age. A successful HTTP
   decision or successful batch exit does not prove any individual mail was delivered.
4. Check transactional/notification flags, the dynamic PostgreSQL sender/domain
   authorization, protected Resend configuration and the externally verified sender.
   These checks do not require printing the provider key or recipient mailbox.
5. Under separately authorised controlled live acceptance, correlate the stable key
   and provider receipt with Resend's event evidence and the controlled inbox. A
   completed outbox row records provider/capture acceptance, **not inbox delivery**.
   No receipt can be inferred from that timestamp alone; inspect bounces/spam/domain
   evidence separately without disclosing internal registration reasons.
6. Failure preserves the decision and records a safe failure category/backoff. Never
   reset exhausted attempts or replay historical recipients as a diagnostic shortcut.

## Production supervision proposal

Use the existing `node scripts/worker-loop.mjs approval` under one reviewed process
supervisor, with only the notification-role and EmailService environment. It covers
both applicant outcomes and new approver alerts, batches 20 sequential intents and
waits 60–65 seconds. Do not add a second cron/timer. Retain lease recovery, restart
limits, a shutdown allowance of at least 200 seconds and alerts for old/exhausted
queues and missing cycles. See [worker supervision](worker-supervision.md). Actual
VPS scheduling, restarts, deliverability and alert routing remain untested and were
not activated.
