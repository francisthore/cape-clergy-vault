import { connectLocalRuntime } from "../../../database/runtime.server.ts";
import { configuredEmail } from "../email/service.server.ts";
import { createAuthService } from "./service.server.ts";
let service: Promise<ReturnType<typeof createAuthService>> | undefined;
export function getAuthService() {
  if (!service)
    service = (async () => {
      const secret = process.env["BETTER_AUTH_SECRET"];
      const baseURL = process.env["BETTER_AUTH_URL"];
      if (!secret || !baseURL) throw new Error("Explicit Better Auth secret and origin required");
      // This phase has intentionally local-only DB safety guards and a draft notice.
      // NODE_ENV=production is also used by the local Node build; deployment remains blocked.
      const connection = await connectLocalRuntime();
      const email = configuredEmail(baseURL, process.env, connection.client);
      return createAuthService(connection, email, { secret, baseURL });
    })().catch((error: unknown) => {
      service = undefined;
      throw error;
    });
  return service;
}
export async function handleAuth(request: Request) {
  try {
    const response = await (await getAuthService()).handle(request);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("Referrer-Policy", "no-referrer");
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json(
      { message: "Authentication is not configured. Contact the application maintainer." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
