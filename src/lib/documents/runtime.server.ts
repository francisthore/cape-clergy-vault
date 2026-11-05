import { getAuthService } from "../auth/runtime.server.ts";
import { createDocumentService, privateHeaders } from "./service.server.ts";
import { configuredStorage } from "./storage.server.ts";
export async function handleDocuments(request: Request, documentId?: string) {
  try {
    return await createDocumentService(
      await getAuthService(),
      configuredStorage(),
      process.env["BETTER_AUTH_URL"]!,
      Number(process.env["CAPE_MAX_UPLOAD_BYTES"] ?? 20 * 1024 * 1024),
    ).handle(request, documentId);
  } catch {
    return Response.json(
      { message: "Documents are unavailable." },
      { status: 503, headers: privateHeaders },
    );
  }
}
