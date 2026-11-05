import { getAuthService } from "../auth/runtime.server.ts";
import { failure } from "../server/http.server.ts";
import { createReviewService } from "./service.server.ts";
export async function handleReviews(request: Request) {
  try {
    return await createReviewService(
      await getAuthService(),
      process.env["BETTER_AUTH_URL"]!,
    ).handle(request);
  } catch (e) {
    return failure(e);
  }
}
export async function authorizeReviewerPage(headers: Headers, id?: string) {
  try {
    await createReviewService(await getAuthService(), process.env["BETTER_AUTH_URL"]!).authorize(
      headers,
      async (tx) => {
        if (id) {
          const [r] = await tx`select app.can_review_submission(${id}::uuid) as allowed`;
          if (!r?.["allowed"]) throw Object.assign(Error("Unavailable"), { code: "P0002" });
        }
      },
    );
    return null;
  } catch (e) {
    return failure(e);
  }
}
