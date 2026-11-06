import { z } from "zod";
import type { createAuthService } from "../auth/service.server.ts";
import { failure, json, readInput, RequestError } from "../server/http.server.ts";
import { digestInvitation } from "./tokens.server.ts";
const query = z
  .object({
    id: z.string().uuid().optional(),
    search: z.string().max(200).default(""),
    status: z.enum(["", "submitted", "under_review", "accepted", "returned"]).default(""),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();
const invitation = z
  .object({
    action: z.enum(["inspect-invitation", "accept-invitation"]),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
const decision = z
  .object({
    action: z.literal("decide"),
    id: z.string().uuid(),
    version: z.number().int().positive(),
    outcome: z.enum(["under_review", "accepted", "returned"]),
    feedback: z.string().max(10000),
    privateNotes: z.string().max(10000),
    requestId: z.string().uuid(),
  })
  .strict();
export function createReviewService(auth: ReturnType<typeof createAuthService>, origin: string) {
  const authorize = <T>(
    headers: Headers,
    work: Parameters<typeof auth.withApprovedDatabase<T>>[1],
  ) =>
    auth.withApprovedDatabase(headers, async (tx) => {
      const [allowed] = await tx`select app.is_reviewer() as allowed`;
      if (!allowed?.["allowed"])
        throw new RequestError(
          403,
          "Active reviewer authorization and current consent are required.",
        );
      return work(tx);
    });
  async function handle(request: Request) {
    try {
      if (request.method === "POST") {
        const denied = await auth.limitOperation(request, "admin");
        if (denied) return denied;
      }
      if (request.method === "GET") {
        const q = query.parse(Object.fromEntries(new URL(request.url).searchParams));
        return json(
          await authorize(request.headers, async (tx) => {
            if (q.id) {
              const [s] =
                await tx`select id,kind,title,category,abstract,keywords,confidential,status,version,revision,submitted_at,created_at from app.submissions where id=${q.id} and app.can_review_submission(id)`;
              if (!s) throw new RequestError(404, "Item unavailable or access denied.");
              const [a] =
                await tx`select created_at as assigned_at from app.reviewer_assignments where submission_id=${q.id} and reviewer_id=app.request_user_id() and status='active' and revision=${s["revision"]}`;
              const [author] = await tx`select app.reviewer_author(${q.id}) as author`;
              const documents =
                await tx`select id,file_name,byte_size::text from app.documents where submission_id=${q.id} and state='available' and not excluded order by created_at,id limit 100`;
              const history =
                await tx`select id,outcome,notes,author_feedback,revision,created_at from app.review_decisions where submission_id=${q.id} order by created_at desc,id desc limit 100`;
              return {
                submission: s,
                assignment: a,
                author: author!["author"],
                documents,
                history,
              };
            }
            const [r] = await tx`with eligible as materialized (
 select s.id,s.kind,s.title,s.category,s.confidential,s.status,s.revision,s.submitted_at,a.created_at as assigned_at
 from app.submissions s join app.reviewer_assignments a on a.submission_id=s.id and a.revision=s.revision
 where a.reviewer_id=app.request_user_id() and a.status='active' and app.can_review_submission(s.id)
 and (${q.status}='' or s.status::text=${q.status}) and (${q.search}='' or position(lower(${q.search}) in lower(s.title||' '||s.category||' '||s.abstract))>0)
 ), page_rows as(select * from eligible order by assigned_at desc,id desc limit 20 offset ${(q.page - 1) * 20})
 select coalesce((select jsonb_agg(p order by p.assigned_at desc,p.id desc) from page_rows p),'[]'::jsonb) as items,(select count(*)::int from eligible) as total`;
            return { items: r!["items"], total: r!["total"], page: q.page };
          }),
        );
      }
      if (request.method !== "POST") return json({}, 405);
      const input = await readInput(request, origin);
      if (
        typeof input === "object" &&
        input !== null &&
        "action" in input &&
        ["inspect-invitation", "accept-invitation"].includes(String(input.action))
      ) {
        const denied = await auth.limitOperation(request, "invitation");
        if (denied) return denied;
        const v = invitation.parse(input),
          digest = digestInvitation(v.token);
        const result = await auth.withApprovedDatabase(request.headers, async (tx) => {
          if (v.action === "inspect-invitation") {
            const [r] = await tx`select app.inspect_reviewer_invitation(${digest}) as invitation`;
            return { invitation: r!["invitation"] };
          }
          try {
            await tx`select app.accept_reviewer_invitation(${digest})`;
          } catch (error) {
            if ((error as { code?: string }).code === "22023")
              throw new RequestError(
                400,
                "This invitation is expired, used, revoked or unavailable for this account. Ask the trusted operator for help.",
              );
            throw error;
          }
          return {
            message:
              "Reviewer invitation accepted. Your assignments will appear in the reviewer workspace.",
          };
        });
        return json(result);
      }
      const v = decision.parse(input);
      const result = await authorize(request.headers, async (tx) => {
        const [r] =
          await tx`select app.decide_review(${v.id},${v.version},${v.outcome},${v.feedback},${v.privateNotes},${v.requestId}) as decision`;
        return r!["decision"];
      });
      return json({ decision: result, message: "Review recorded." });
    } catch (error) {
      return failure(error);
    }
  }
  return { authorize, handle };
}
