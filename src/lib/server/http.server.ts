import { z } from "zod";
export const privateHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: privateHeaders });
export class RequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export async function readInput(request: Request, origin: string) {
  if (request.headers.get("origin") !== origin) throw new RequestError(403, "Untrusted origin.");
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new RequestError(415, "JSON required.");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "Request required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 32768) {
      await reader.cancel();
      throw new RequestError(413, "Request too large.");
    }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export function failure(error: unknown) {
  if (error instanceof RequestError) return json({ message: error.message }, error.status);
  if (error instanceof z.ZodError)
    return json({ message: error.issues[0]?.message ?? "Check the supplied fields." }, 400);
  if (error instanceof SyntaxError) return json({ message: "Invalid request." }, 400);
  const code = (error as { code?: string }).code;
  if (code === "40001" || code === "23505" || code === "40P01")
    return json({ message: "This item changed. Reload before trying again." }, 409);
  if (code === "22023")
    return json(
      { message: "Check required fields, attachments, authorized domain and current state." },
      400,
    );
  if (code === "P0002") return json({ message: "Item unavailable or access denied." }, 404);
  if (code === "P0003")
    return json({ message: "Wait one minute before sending another test." }, 429);
  if (
    code === "42501" ||
    (error instanceof Error &&
      ["Authenticated server session required", "Approved account required"].includes(
        error.message,
      ))
  )
    return json(
      {
        message: "A verified approved account with the required permission and consent is needed.",
      },
      403,
    );
  console.error("application.operation_failed");
  return json({ message: "Service unavailable. Your request could not be completed." }, 503);
}
