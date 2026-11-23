-- Run via the restricted operator reporting session after target identity verification.
-- Aggregate output only. Worker heartbeats and host health come from systemd.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT state,provider_status,count(*) jobs,min(created_at) oldest,max(poll_count) max_polls
FROM app.document_scans WHERE state IN ('queued','scanning','exhausted')
GROUP BY state,provider_status ORDER BY state,provider_status;
SELECT period,reserved,observed_used,blocked_until FROM app.scanner_budget
WHERE period=to_char(now() AT TIME ZONE 'UTC','YYYY-MM');
SELECT queue,count(*) pending,min(created_at) oldest,count(*) FILTER(WHERE attempts>=8) exhausted
FROM (SELECT 'approval' queue,created_at,attempts FROM app.approval_notifications
      WHERE delivered_at IS NULL AND cancelled_at IS NULL
      UNION ALL SELECT 'reviewer',created_at,attempts FROM app.reviewer_notifications
      WHERE delivered_at IS NULL AND cancelled_at IS NULL) q GROUP BY queue;
SELECT action,count(*) events FROM app.audit_events WHERE created_at>now()-interval '1 hour'
AND (outcome='error' OR action='submission.intake_no_recipients') GROUP BY action;
COMMIT;
