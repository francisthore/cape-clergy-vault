import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Sql } from "postgres";
import type { EmailService } from "../email/service.server.ts";
import type { EmailKind } from "../email/templates.server.ts";
import { digestInvitation, openInvitationProof } from "../reviews/tokens.server.ts";
// Shared durable outboxes; each SQL call commits before provider I/O.
export async function deliverNotifications(
  connection: { client: Sql },
  email: EmailService,
  origin: string,
  queue: "approval" | "reviewer",
  secret: string,
  limit = 20,
  onlyId: string | null = null,
) {
  let delivered = 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error("Invalid batch size");
  for (let i = 0; i < limit; i++) {
    const lease = randomUUID();
    const [claimed] =
      await connection.client`select app.claim_notification(${queue},${lease},${onlyId}) as data`;
    const job = claimed?.["data"];
    if (!job) break;
    const id = String(job.id),
      kind = job.kind as EmailKind;
    try {
      const sender = await email.senderSettings(kind);
      const [prepared] =
        await connection.client`select app.prepare_notification(${queue},${id},${lease},${sender.from},${sender.replyTo ?? ""}) as data`;
      const payload = prepared?.["data"];
      if (!payload) continue;
      let url = `${origin}/account`;
      if (queue === "reviewer") {
        if (kind === "reviewer_invitation") {
          const proof = openInvitationProof(
            String(payload.sealedToken),
            secret,
            String(payload.identity),
          );
          if (
            !timingSafeEqual(
              Buffer.from(digestInvitation(proof)),
              Buffer.from(String(payload.digest)),
            )
          )
            throw Error("Proof mismatch");
          url = `${origin}/reviewer/invitation#token=${proof}`;
        } else {
          url = `${origin}/${kind === "review_assigned" ? "reviewer/submissions" : "submissions"}/${payload.submissionId}`;
        }
      }
      const [checked] =
        await connection.client`select app.check_notification(${queue},${id},${lease}) as allowed`;
      if (!checked?.["allowed"]) continue;
      await email.send(kind, String(payload.to), url, `${queue}:${id}`, {
        from: String(payload.from),
        replyTo: String(payload.replyTo),
      });
      const [finished] =
        await connection.client`select app.finish_notification(${queue},${id},${lease},true) as finished`;
      if (finished?.["finished"]) delivered++;
    } catch {
      // Only safe categories cross the DB boundary; never provider payloads/proof.
      await connection.client`select app.finish_notification(${queue},${id},${lease},false)`;
    }
  }
  return delivered;
}
