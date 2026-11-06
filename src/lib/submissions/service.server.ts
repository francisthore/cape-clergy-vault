import type { createAuthService } from "../auth/service.server.ts";
import { draftSchema, querySchema, transitionSchema } from "./validation.ts";
import { failure, json, readInput, RequestError } from "../server/http.server.ts";
export function createSubmissionService(
  auth: ReturnType<typeof createAuthService>,
  origin: string,
) {
  const authorize = <T>(
    headers: Headers,
    work: Parameters<typeof auth.withApprovedDatabase<T>>[1],
  ) =>
    auth.withApprovedDatabase(headers, async (tx) => {
      await tx`select app.require_submission_account()`;
      return work(tx);
    });
  async function handle(request: Request, repository = false) {
    try {
      if (request.method === "GET" && repository) {
        const denied = await auth.limitOperation(request, "search");
        if (denied) return denied;
      }
      if (request.method === "GET") {
        const q = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
        return json(
          await authorize(request.headers, async (tx) => {
            if (q.id) {
              const rows =
                await tx`select id,kind,title,category,abstract,keywords,confidential,status,version,revision,created_at,submitted_at
       from app.submissions where id=${q.id} and
       (case when ${repository} then status::text='accepted' and not confidential else owner_id=app.request_user_id() end)`;
              if (!rows.length) throw new RequestError(404, "Item unavailable or access denied.");
              const documents =
                await tx`select id,file_name,byte_size::text,state,excluded,app.document_is_clean(id) as clean from app.documents where submission_id=${q.id}
       and (not ${repository} or (app.document_is_clean(id) and not excluded)) order by created_at,id limit 100`;
              const history = repository
                ? []
                : await tx`select event,version,revision,created_at from app.submission_events where submission_id=${q.id} order by created_at desc,id desc limit 100`;
              const [review] = repository
                ? []
                : await tx`select app.author_review_feedback(${q.id}) as feedback`;
              return {
                submission: rows[0],
                documents,
                history,
                feedback: review?.["feedback"] ?? [],
              };
            }
            // Explicit repository predicate applies before counts and pagination, even for reviewers.
            const [result] =
              await tx`with eligible as materialized (select s.id,s.kind,s.title,s.category,s.abstract,s.keywords,s.confidential,s.status,s.version,s.revision,s.created_at,s.submitted_at,
       (select count(*)::int from app.documents d where d.submission_id=s.id and not d.excluded and (not ${repository} or app.document_is_clean(d.id))) as document_count,
       s.owner_id
       from app.submissions s where (case when ${repository} then s.status::text='accepted' and not s.confidential else s.owner_id=app.request_user_id() end)
       and (${q.status}='' or s.status::text=${q.status}) and (${q.category}='' or s.category=${q.category})
       and (${q.keyword}='' or ${q.keyword}=any(s.keywords))
       and (${q.search}='' or position(lower(${q.search}) in lower(s.title||' '||s.abstract||' '||s.category||' '||array_to_string(s.keywords,' ')))>0)
       ), page_rows as (select * from eligible order by created_at desc,id desc limit 20 offset ${(q.page - 1) * 20})
       select coalesce((select jsonb_agg(to_jsonb(p)-'owner_id' order by p.created_at desc,p.id desc) from page_rows p),'[]'::jsonb) as items,
       (select count(*)::int from eligible) as total`;
            return { items: result!["items"], total: result!["total"], page: q.page };
          }),
        );
      }
      if (request.method !== "POST" || repository) return json({}, 405);
      const input = await readInput(request, origin);
      if (
        typeof input === "object" &&
        input !== null &&
        "action" in input &&
        input.action === "save"
      ) {
        const v = draftSchema.parse(input);
        const id = await authorize(request.headers, async (tx) => {
          const [row] =
            await tx`select app.save_draft(${v.id ?? null},${v.version},${v.kind},${v.title},${v.category},${v.abstract},${v.keywords},${v.confidential}) as id`;
          return row!["id"];
        });
        return json({ id, message: "Draft saved." });
      }
      const v = transitionSchema.parse(input);
      await authorize(request.headers, async (tx) =>
        v.action === "exclude"
          ? tx`select app.exclude_draft_document(${v.id},${v.version})`
          : tx`select app.transition_submission(${v.id},${v.version},${v.action})`,
      );
      return json({
        message:
          v.action === "submit"
            ? "Submitted for review."
            : v.action === "amend"
              ? "Amendment draft created."
              : "Attachment excluded; retained privately for history.",
      });
    } catch (error) {
      return failure(error);
    }
  }
  return { authorize, handle };
}
