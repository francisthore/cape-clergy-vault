import { randomUUID } from "node:crypto";
import type { connectLocalDatabase } from "../../../database/connection.server.ts";
import type { EmailService } from "../email/service.server.ts";
import type { EmailKind } from "../email/templates.server.ts";

// Operator-only connection; never imported by web handlers. Leases survive restarts.
export async function deliverApprovalNotifications(
  owner: Awaited<ReturnType<typeof connectLocalDatabase>>,
  email: EmailService,
  origin: string,
  limit = 20,
  onlyId: string | null = null,
) {
  let delivered = 0;
  for (let i = 0; i < Math.min(limit, 100); i++) {
    const token = randomUUID();
    const rows = await owner.client.begin(async (tx) => {
      return tx`update app.approval_notifications n set attempts=n.attempts+1,
        lease_token=${token}, available_at=now()+interval '5 minutes'
        where n.id=(select id from app.approval_notifications where delivered_at is null
        and attempts<8 and available_at<=now() and (${onlyId}::uuid is null or id=${onlyId}::uuid) order by created_at,id for update skip locked limit 1)
        returning n.id,n.kind,n.user_id,n.attempts`;
    });
    const row = rows[0];
    if (!row) break;
    try {
      const [user] = await owner.client`select email from auth.users where id=${row["user_id"]}`;
      if (!user) throw new Error("Missing recipient");
      const effective = await email.senderSettings(row["kind"] as EmailKind);
      const [snapshot] =
        await owner.client`update app.approval_notifications set sender_from=coalesce(sender_from,${effective.from}),
       sender_reply_to=coalesce(sender_reply_to,${effective.replyTo ?? ""}),recipient_email=coalesce(recipient_email,${String(user["email"])})
       where id=${row["id"]} and lease_token=${token} returning sender_from,sender_reply_to,recipient_email`;
      if (!snapshot) continue;
      await email.send(
        row["kind"] as EmailKind,
        String(snapshot["recipient_email"]),
        `${origin}/account`,
        `approval:${row["id"]}`,
        { from: String(snapshot["sender_from"]), replyTo: String(snapshot["sender_reply_to"]) },
      );
      const updated =
        await owner.client`update app.approval_notifications set delivered_at=now(),lease_token=null,last_error=null
        where id=${row["id"]} and lease_token=${token} returning id`;
      delivered += updated.length;
    } catch {
      // Never persist provider errors, recipients or email payloads.
      await owner.client`update app.approval_notifications set lease_token=null,last_error='delivery_failed',
        available_at=now()+least(3600,30*power(2,attempts)) * interval '1 second'
        where id=${row["id"]} and lease_token=${token}`;
    }
  }
  return delivered;
}
