import { getAuthService } from "../auth/runtime.server.ts";
import { createSettingsService } from "./service.server.ts";
import { configuredEmail } from "../email/service.server.ts";
import { connectLocalRuntime } from "../../../database/runtime.server.ts";
import { failure } from "../server/http.server.ts";
let connection: ReturnType<typeof connectLocalRuntime> | undefined;
export async function settingsService() {
  connection ??= connectLocalRuntime().catch((error) => {
    connection = undefined;
    throw error;
  });
  const db = await connection;
  const origin = process.env["BETTER_AUTH_URL"]!;
  const real = process.env["EMAIL_PROVIDER"] === "resend" && process.env["NODE_ENV"] !== "test";
  return createSettingsService(
    await getAuthService(),
    configuredEmail(origin, process.env, db.client),
    origin,
    real ? "Resend configured (environment credential)" : "captured",
  );
}
export async function handleSettings(request: Request) {
  try {
    return await (await settingsService()).handle(request);
  } catch (error) {
    return failure(error);
  }
}
export async function authorizeSettingsPage(headers: Headers) {
  try {
    await (await settingsService()).authorize(headers, async () => true);
    return null;
  } catch (error) {
    return failure(error);
  }
}
