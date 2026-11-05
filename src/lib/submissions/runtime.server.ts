import { getAuthService } from "../auth/runtime.server.ts";
import { createSubmissionService } from "./service.server.ts";
import { failure } from "../server/http.server.ts";
export async function handleSubmissions(request: Request, repository = false) {
  try {
    return await createSubmissionService(
      await getAuthService(),
      process.env["BETTER_AUTH_URL"]!,
    ).handle(request, repository);
  } catch (error) {
    return failure(error);
  }
}
export async function authorizeSubmissionPage(headers: Headers) {
  try {
    await createSubmissionService(
      await getAuthService(),
      process.env["BETTER_AUTH_URL"]!,
    ).authorize(headers, async () => true);
    return null;
  } catch (error) {
    return failure(error);
  }
}
