import { z } from "zod";
import type { TransactionSql } from "postgres";
import type { createAuthService } from "../auth/service.server.ts";

export function createApprovalService(auth: ReturnType<typeof createAuthService>, origin: string) {
  const decisionSchema = z
    .object({
      targetId: z.string().min(1).max(200),
      action: z.enum(["approve", "reject", "suspend", "reactivate"]),
      reason: z.string().trim().max(1000),
      requestId: z.string().uuid(),
    })
    .strict();
  const querySchema = z
    .object({
      status: z.enum(["pending", "approved", "rejected", "suspended", "all"]).default("pending"),
      search: z.string().trim().max(120).default(""),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      id: z.string().min(1).max(200).optional(),
    })
    .strict();
  async function authorize<T>(headers: Headers, work: (tx: TransactionSql) => Promise<T>) {
    return auth.withApprovedDatabase(headers, async (tx) => {
      await tx`select app.require_approver()`;
      return work(tx);
    });
  }
  async function handle(request: Request) {
    const json = (body: unknown, status = 200) =>
      Response.json(body, {
        status,
        headers: { "Cache-Control": "no-store", Vary: "Cookie", "Referrer-Policy": "no-referrer" },
      });
    try {
      if (request.method === "GET") {
        const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
        return json(
          await authorize(request.headers, async (tx) => {
            const [row] = query.id
              ? await tx`select app.registration_detail(${query.id}) as data`
              : await tx`select app.registration_list(${query.status},${query.search},${query.page}) as data`;
            return row!["data"];
          }),
        );
      }
      if (request.method !== "POST") return json({}, 405);
      if (request.headers.get("origin") !== origin)
        return json({ message: "Untrusted origin" }, 403);
      // Stream cap protects even requests with no Content-Length.
      const reader = request.body?.getReader();
      if (!reader) return json({}, 400);
      let raw = "";
      const decoder = new TextDecoder();
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 4096) {
          await reader.cancel();
          return json({}, 413);
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
      const input = decisionSchema.parse(JSON.parse(raw));
      const id = await authorize(request.headers, async (tx) => {
        const [row] =
          await tx`select app.decide_registration(${input.targetId},${input.action},${input.reason},${input.requestId}) as id`;
        return row!["id"];
      });
      return json({ id, message: "Decision recorded. Notification queued." });
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return json({ message: "Check the supplied fields." }, 400);
      const code = (error as { code?: string }).code;
      if (code === "22023" || code === "23505" || code === "40P01")
        return json(
          {
            message:
              "Decision could not be applied. Refresh the registration and check its status.",
          },
          409,
        );
      if (code === "P0002") return json({ message: "Registration not found." }, 404);
      if (
        code !== "42501" &&
        !(
          error instanceof Error &&
          ["Authenticated server session required", "Approved account required"].includes(
            error.message,
          )
        )
      ) {
        console.error("approval.operation_failed");
        return json(
          {
            message:
              "Administration is temporarily unavailable. Refresh and check the current status before retrying.",
          },
          503,
        );
      }
      // No account data, SQL, session or identity details in errors.
      return json(
        { message: "A verified, approved account with approval permission is required." },
        403,
      );
    }
  }
  return { handle, authorize };
}
