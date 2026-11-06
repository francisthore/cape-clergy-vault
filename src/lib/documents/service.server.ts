import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { createAuthService } from "../auth/service.server.ts";
import { DocumentError, validateFileName } from "./storage.server.ts";
import type { StorageProvider, OpenObject } from "./storage.server.ts";

const uuid = z.string().uuid();
const querySchema = z.object({ submissionId: uuid, requestId: uuid.optional() }).strict();
export const privateHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export function createDocumentService(
  auth: ReturnType<typeof createAuthService>,
  storage: StorageProvider,
  origin: string,
  maxBytes = 20 * 1024 * 1024,
) {
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: privateHeaders });
  const audit = (headers: Headers, id: string | null, event: string, correlation: string) =>
    auth.withAuditDatabase(headers, async (tx) => {
      await tx`select app.record_document_access(${id},${event},${correlation})`;
    });
  async function gate(headers: Headers) {
    await auth.withApprovedDatabase(headers, async (tx) => {
      const [row] = await tx`select app.document_account_allowed() as allowed`;
      if (!row?.["allowed"])
        throw new DocumentError(403, "Current repository consent is required.");
    });
  }
  async function upload(request: Request) {
    if (request.headers.get("origin") !== origin) throw new DocumentError(403, "Untrusted origin.");
    await gate(request.headers);
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.requestId || !request.body)
      throw new DocumentError(400, "Upload ID and file body required.");
    let name: string;
    try {
      name = validateFileName(decodeURIComponent(request.headers.get("x-document-name") ?? ""));
    } catch (error) {
      if (error instanceof DocumentError) throw error;
      throw new DocumentError(400, "Invalid filename.");
    }
    if (request.headers.get("content-type")?.split(";")[0] !== "application/pdf")
      throw new DocumentError(415, "Upload a PDF file body.");
    const length = request.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
      throw new DocumentError(413, "Document exceeds the upload limit.");
    const id = randomUUID();
    const storageKey = randomUUID();
    const requestId = query.requestId;
    // RLS checks parent ownership, consent, account verification and editable state.
    // Finalization separately locks/rechecks the parent after the upload.
    await auth.withApprovedDatabase(request.headers, async (tx) => {
      const rows = await tx`select id from app.submissions where id=${query.submissionId}
       and owner_id=app.request_user_id() and status='draft' and kind='document'`;
      if (!rows.length)
        throw new DocumentError(403, "This submission is not editable by your account.");
      await tx`insert into app.documents(id,submission_id,storage_key,file_name,media_type,byte_size,upload_request_id)
       values(${id},${query.submissionId},${storageKey},${name},'application/pdf',0,${requestId})`;
    });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5 * 60_000)]);
    try {
      const object = await storage.save(storageKey, request.body, signal);
      signal.throwIfAborted();
      // A new session/permission check after slow network I/O, outside the upload.
      await auth.withApprovedDatabase(request.headers, async (tx) => {
        await tx`select app.finalize_document(${id},${object.byteSize},${object.sha256})`;
      });
      return json({ id, message: "Document uploaded. Security checks are pending." }, 201);
    } catch (error) {
      // Never remove a finalized quarantined/available object after an uncertain DB commit.
      try {
        const state = await auth.withAuditDatabase(request.headers, async (tx) => {
          const [row] = await tx`select app.fail_document(${id}) as state`;
          return row?.["state"];
        });
        if (state === "failed") await storage.delete(storageKey);
      } catch {
        console.error("document.upload_reconciliation_required", { documentId: id });
      }
      throw error;
    }
  }
  async function list(request: Request) {
    await gate(request.headers);
    const query = z
      .object({ submissionId: uuid })
      .strict()
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    const rows = await auth.withApprovedDatabase(request.headers, async (tx) => {
      const parents = await tx`select id from app.submissions where id=${query.submissionId}`;
      if (!parents.length) throw new DocumentError(404, "Submission unavailable or access denied.");
      // Explicit projection: storage keys and hashes are never exposed.
      return tx`select id,file_name,media_type,byte_size::text,created_at,state
        from app.documents where submission_id=${query.submissionId} order by created_at,id limit 100`;
    });
    return json({ documents: rows });
  }
  async function download(request: Request, documentId: string) {
    const correlation = randomUUID();
    const parsed = uuid.safeParse(documentId);
    if (!parsed.success) {
      await audit(request.headers, null, "denied", correlation);
      throw new DocumentError(400, "Invalid document request.");
    }
    const id = parsed.data;
    let object: OpenObject | undefined;
    try {
      try {
        await gate(request.headers);
      } catch (error) {
        await audit(request.headers, id, "denied", correlation);
        throw error;
      }
      const document = await auth.withApprovedDatabase(request.headers, async (tx) => {
        const [row] =
          await tx`select storage_key,file_name,media_type,byte_size::text,state,app.document_is_clean(id) as clean
          from app.documents where id=${id}`;
        return row;
      });
      if (!document || document["state"] !== "available" || !document["clean"]) {
        await audit(request.headers, id, "unavailable", correlation);
        throw new DocumentError(404, "Document unavailable or access denied.");
      }
      await audit(request.headers, id, "authorized", correlation);
      try {
        object = await storage.open(String(document["storage_key"]));
        if (object.byteSize !== Number(document["byte_size"]))
          throw new Error("Storage size mismatch");
      } catch {
        await object?.close();
        object = undefined;
        await audit(request.headers, id, "open_failed", correlation);
        throw new DocumentError(404, "Document unavailable or access denied.");
      }
      // Required audit rechecks live approval/consent/visibility after opening.
      await audit(request.headers, id, "started", correlation);
      request.signal.throwIfAborted();
      const name = validateFileName(String(document["file_name"]));
      const opened = object;
      let terminal = false,
        transferred = 0;
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const finish = async (event: string) => {
        if (terminal) return;
        terminal = true;
        request.signal.removeEventListener("abort", abort);
        try {
          await opened.close();
        } catch {
          event = "transfer_failed";
          console.error("document.stream_cleanup_failed", { correlationId: correlation });
        } finally {
          try {
            await audit(request.headers, id, event, correlation);
          } catch {
            console.error("document.transfer_audit_failed", { correlationId: correlation });
          }
        }
      };
      const abort = () => {
        if (terminal) return;
        controller.error(new Error("Transfer cancelled"));
        void finish("cancelled").catch(() => console.error("document.stream_cleanup_failed"));
      };
      const body = new ReadableStream<Uint8Array>(
        {
          start(c) {
            controller = c;
            request.signal.addEventListener("abort", abort, { once: true });
          },
          async pull(c) {
            if (terminal) return;
            try {
              const chunk = await opened.read();
              if (terminal) return;
              if (chunk) {
                transferred += chunk.byteLength;
                if (transferred > opened.byteSize) throw new Error("Object changed");
                c.enqueue(chunk);
              } else {
                if (transferred !== opened.byteSize) throw new Error("Truncated object");
                await finish("stream_ended");
                c.close();
              }
            } catch {
              if (!terminal) {
                await finish("transfer_failed");
                c.error(new Error("Document transfer failed"));
              }
            }
          },
          async cancel() {
            await finish("cancelled");
          },
        },
        { highWaterMark: 0 },
      );
      const encodedName = encodeURIComponent(name).replace(
        /['()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      );
      return new Response(body, {
        headers: {
          ...privateHeaders,
          "Content-Type": "application/pdf",
          "Content-Length": String(opened.byteSize),
          "Content-Disposition": `attachment; filename="document.pdf"; filename*=UTF-8''${encodedName}`,
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "X-Request-ID": correlation,
        },
      });
    } catch (error) {
      await object?.close();
      throw error;
    }
  }
  async function handle(request: Request, documentId?: string): Promise<Response> {
    try {
      if (documentId && request.method === "GET") return await download(request, documentId);
      if (!documentId && request.method === "POST") return await upload(request);
      if (!documentId && request.method === "GET") return await list(request);
      return json({ message: "Method not allowed." }, 405);
    } catch (error) {
      if (error instanceof DocumentError) return json({ message: error.message }, error.status);
      if (error instanceof z.ZodError) return json({ message: "Invalid document request." }, 400);
      const code = (error as { code?: string }).code;
      if (code === "23505")
        return json(
          {
            message: "Upload request already recorded. Refresh the document list before retrying.",
          },
          409,
        );
      if (
        code === "42501" ||
        (error instanceof Error &&
          ["Authenticated server session required", "Approved account required"].includes(
            error.message,
          ))
      )
        return json(
          { message: "A verified, approved account and current repository consent are required." },
          403,
        );
      if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
        return json({ message: "Upload cancelled or timed out." }, 408);
      console.error("document.operation_failed");
      return json(
        { message: "Documents are temporarily unavailable. Refresh before retrying." },
        503,
      );
    }
  }
  return { handle };
}
