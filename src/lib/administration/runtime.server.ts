import { getAuthService } from "../auth/runtime.server.ts";
import { failure } from "../server/http.server.ts";
import { createAdministrationService } from "./service.server.ts";
export async function handleAdministration(request: Request) {
  try {
    return await createAdministrationService(
      await getAuthService(),
      process.env["BETTER_AUTH_URL"]!,
      process.env["BETTER_AUTH_SECRET"]!,
    ).handle(request);
  } catch (error) {
    return failure(error);
  }
}
