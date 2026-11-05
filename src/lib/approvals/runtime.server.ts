import { getAuthService } from "../auth/runtime.server.ts";
import { createApprovalService } from "./service.server.ts";
export async function handleApprovals(request: Request) {
  try {
    return await createApprovalService(
      await getAuthService(),
      process.env["BETTER_AUTH_URL"]!,
    ).handle(request);
  } catch {
    return Response.json(
      { message: "Administration is unavailable." },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

export async function authorizeApprovalPage(headers: Headers): Promise<Response | null> {
  try {
    const auth = await getAuthService();
    await createApprovalService(auth, process.env["BETTER_AUTH_URL"]!).authorize(
      headers,
      async () => true,
    );
    return null;
  } catch {
    return Response.json(
      { message: "A verified, approved account with approval permission is required." },
      {
        status: 403,
        headers: { "Cache-Control": "no-store", Vary: "Cookie", "Referrer-Policy": "no-referrer" },
      },
    );
  }
}
