import { z } from "zod";
import type { createAuthService } from "../auth/service.server.ts";
import { failure, json, readInput } from "../server/http.server.ts";
import { createInvitationProof } from "../reviews/tokens.server.ts";
const identity = z.string().min(1).max(200);
const cap = z.enum(["approver", "review_coordinator", "reviewer", "settings_manager"]);
const mutation = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("assign"),
      id: z.string().uuid(),
      revision: z.number().int().positive(),
      reviewerId: identity,
      requestId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("revoke-assignment"),
      id: z.string().uuid(),
      requestId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("access"),
      operation: z.enum(["grant", "revoke", "invite", "cancel-invitation"]),
      identity,
      capability: cap,
      mailbox: z.string().email().max(254),
      confirmation: z.string().max(450),
      reason: z.string().trim().min(10).max(1000),
      requestId: z.string().uuid(),
      invitationId: z.string().uuid().optional(),
    })
    .strict(),
]);
const query = z.discriminatedUnion("view", [
  z
    .object({
      view: z.literal("intake"),
      page: z.coerce.number().int().min(1).max(100000).default(1),
    })
    .strict(),
  z.object({ view: z.literal("identity"), id: identity }).strict(),
]);
export function createAdministrationService(
  auth: ReturnType<typeof createAuthService>,
  origin: string,
  secret: string,
) {
  async function handle(request: Request) {
    try {
      const denied = await auth.limitOperation(request, "admin");
      if (denied) return denied;
      if (request.method === "GET") {
        const q = query.parse(Object.fromEntries(new URL(request.url).searchParams));
        return json(
          await auth.withApprovedDatabase(request.headers, async (tx) => {
            const [row] =
              q.view === "intake"
                ? await tx`select app.coordination_inbox(${q.page}) as data`
                : await tx`select app.access_identity(${q.id}) as data`;
            return row!["data"];
          }),
        );
      }
      if (request.method !== "POST") return json({}, 405);
      const v = mutation.parse(await readInput(request, origin));
      return json(
        await auth.withApprovedDatabase(request.headers, async (tx) => {
          if (v.action === "assign") {
            const [row] =
              await tx`select app.coordinate_assignment(${v.id},${v.revision},${v.reviewerId},${v.requestId}) as id`;
            return { id: row!["id"], message: "Reviewer assigned to the confirmed revision." };
          }
          if (v.action === "revoke-assignment") {
            await tx`select app.coordination_revoke_assignment(${v.id},${v.requestId})`;
            return { message: "Assignment revoked. Further access requires a valid assignment." };
          }
          // Check authority before generating an encrypted proof; SQL repeats it under locks.
          await tx`select app.require_delegation(${v.capability})`;
          const proof =
            v.operation === "invite" && v.capability === "reviewer"
              ? createInvitationProof(secret, v.identity)
              : null;
          const [row] =
            await tx`select app.manage_access(${v.operation},${v.identity},${v.capability},${v.mailbox},${v.confirmation},${v.reason},${v.requestId},${v.invitationId ?? null},${proof?.digest ?? null},${proof?.sealed ?? null}) as id`;
          return {
            id: row!["id"],
            message:
              v.operation === "invite"
                ? "Invitation queued. Reviewer access requires mailbox proof and explicit acceptance within one hour of issue."
                : "Access operation recorded.",
          };
        }),
      );
    } catch (error) {
      return failure(error);
    }
  }
  return { handle };
}
