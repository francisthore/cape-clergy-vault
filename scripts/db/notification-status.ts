// Aggregate read-only operator diagnostics. No addresses, payloads, proof or delivery.
import { connectLocalDatabase } from "../../database/connection.server.ts";
const connection = await connectLocalDatabase();
try {
  const report = await connection.client.begin(async (tx) => {
    await tx`set transaction read only`;
    const queue = await tx`select kind,
      case when delivered_at is not null then 'completed'
        when cancelled_at is not null then 'cancelled'
        when attempts>=8 then 'exhausted'
        when lease_token is not null and available_at>now() then 'leased'
        when available_at>now() then 'retry_wait' else 'queued' end as state,
      count(*)::int as count, max(attempts)::int as maximum_attempts,
      floor(extract(epoch from now()-min(created_at)))::bigint::text as oldest_age_seconds
      from app.approval_notifications group by kind,state order by kind,state`;
    const reviewerQueue = await tx`select kind,
      case when delivered_at is not null then 'completed'
        when cancelled_at is not null then 'cancelled'
        when attempts>=8 then 'exhausted'
        when lease_token is not null and available_at>now() then 'leased'
        when available_at>now() then 'retry_wait' else 'queued' end as state,
      count(*)::int as count, max(attempts)::int as maximum_attempts,
      floor(extract(epoch from now()-min(created_at)))::bigint::text as oldest_age_seconds
      from app.reviewer_notifications group by kind,state order by kind,state`;
    const [intake] = await tx`select count(*)::int as submissions_without_intake_recipients,
      max(created_at) as latest_no_recipient_event from app.audit_events
      where action='submission.intake_no_recipients'`;
    const [settings] = await tx`select transactional_enabled,notifications_enabled,
      exists(select 1 from app.email_domains d where d.domain=s.sending_domain and d.authorized_at is not null) as domain_authorized
      from app.email_settings s where id=1`;
    const [active] =
      await tx`select count(*)::int as active_worker_connections from pg_stat_activity where application_name='cape-notification-worker'`;
    return {
      queue,
      reviewerQueue,
      intake,
      settings,
      ...active,
      note: "A disconnected worker may be between cycles. Completion records provider or capture acceptance, not inbox delivery. Inspect the supervisor and provider evidence separately; this command sends no mail.",
    };
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await connection.close();
}
