import { randomUUID, timingSafeEqual } from "node:crypto";
import type { connectLocalDatabase } from "../../../database/connection.server.ts";
import type { EmailService } from "../email/service.server.ts";
import type { EmailKind } from "../email/templates.server.ts";
import { digestInvitation, openInvitationProof } from "./tokens.server.ts";
// Guarded operator worker only. Provider I/O follows a committed lease/payload.
export async function deliverReviewerNotifications(
  owner: Awaited<ReturnType<typeof connectLocalDatabase>>,
  email: EmailService,
  origin: string,
  secret: string,
  limit = 20,
  onlyId: string | null = null,
) {
  let delivered = 0;
  for (let i = 0; i < Math.min(limit, 100); i++) {
    const lease = randomUUID();
    const rows = await owner.client.begin(
      (
        tx,
      ) => tx`update app.reviewer_notifications n set attempts=n.attempts+1,lease_token=${lease},available_at=now()+interval '5 minutes'
 where n.id=(select id from app.reviewer_notifications where delivered_at is null and cancelled_at is null and attempts<8 and available_at<=now()
 and (${onlyId}::uuid is null or id=${onlyId}::uuid) order by created_at,id for update skip locked limit 1) returning n.*`,
    );
    const row = rows[0];
    if (!row) break;
    try {
      const kind = row["kind"] as EmailKind;
      const [user] =
        await owner.client`select email,email_verified from auth.users where id=${row["user_id"]}`;
      let valid = !!user?.["email_verified"],
        proof: string | null = null;
      if (kind === "reviewer_invitation") {
        const [inv] =
          await owner.client`select mailbox,token_digest from app.reviewer_invitations where id=${row["invitation_id"]} and state='pending' and expires_at>now()`;
        valid = valid && !!inv && inv["mailbox"] === user!["email"];
        if (valid) {
          proof = openInvitationProof(String(row["sealed_token"]), secret, String(row["user_id"]));
          if (
            !timingSafeEqual(
              Buffer.from(digestInvitation(proof)),
              Buffer.from(String(inv!["token_digest"])),
            )
          )
            throw Error("Proof mismatch");
        }
      } else if (kind === "review_assigned") {
        const allowed = await owner.client.begin(async (tx) => {
          await tx`select set_config('cape.user_id',${row["user_id"]},true)`;
          const [r] = await tx`select app.can_review_submission(${row["submission_id"]}) as allowed,
 exists(select 1 from app.reviewer_assignments where id=${row["assignment_id"]} and status='active') as assignment`;
          return r?.["allowed"] && r?.["assignment"];
        });
        valid = valid && !!allowed;
      }
      if (!valid) {
        await owner.client`update app.reviewer_notifications set cancelled_at=now(),sealed_token=null,lease_token=null,last_error='recipient_ineligible' where id=${row["id"]} and lease_token=${lease}`;
        continue;
      }
      const effective = await email.senderSettings(kind);
      const [snapshot] =
        await owner.client`update app.reviewer_notifications set sender_from=coalesce(sender_from,${effective.from}),sender_reply_to=coalesce(sender_reply_to,${effective.replyTo ?? ""}),recipient_email=coalesce(recipient_email,${String(user!["email"])})
 where id=${row["id"]} and lease_token=${lease} and cancelled_at is null returning sender_from,sender_reply_to,recipient_email`;
      if (!snapshot) continue;
      const url =
        kind === "reviewer_invitation"
          ? `${origin}/reviewer/invitation#token=${proof}`
          : kind === "review_assigned"
            ? `${origin}/reviewer/submissions/${row["submission_id"]}`
            : `${origin}/submissions/${row["submission_id"]}`;
      await email.send(kind, String(snapshot["recipient_email"]), url, `reviewer:${row["id"]}`, {
        from: String(snapshot["sender_from"]),
        replyTo: String(snapshot["sender_reply_to"]),
      });
      const updated =
        await owner.client`update app.reviewer_notifications set delivered_at=now(),sealed_token=null,lease_token=null,last_error=null where id=${row["id"]} and lease_token=${lease}`;
      delivered += updated.count;
    } catch {
      await owner.client`update app.reviewer_notifications set lease_token=null,last_error='delivery_failed',available_at=now()+least(3600,30*power(2,attempts))*interval '1 second' where id=${row["id"]} and lease_token=${lease}`;
    }
  }
  return delivered;
}
