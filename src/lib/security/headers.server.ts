import { randomBytes } from "node:crypto";
export const newCspNonce = () => randomBytes(24).toString("base64");
export function secureResponse(response: Response, request: Request, nonce?: string) {
  const headers = new Headers(response.headers);
  const path = new URL(request.url).pathname;
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  if (nonce) {
    headers.set("X-Frame-Options", "DENY");
    // Preserve the document streaming service's stricter sandbox policy.
    if (headers.get("Content-Type")?.includes("text/html")) {
      headers.set(
        "Content-Security-Policy",
        [
          "default-src 'self'",
          `script-src 'nonce-${nonce}' 'strict-dynamic'`,
          "script-src-attr 'none'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "font-src 'self'",
          "connect-src 'self'",
          "worker-src 'self'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'self'",
          "frame-src 'none'",
          "frame-ancestors 'none'",
        ].join("; "),
      );
      // Nonces and private hydration must never be reused by an intermediary cache.
      headers.set("Cache-Control", "private, no-store");
    }
  }
  if (
    /^\/(?:api|auth|account|documents|admin|submissions|repository|reviewer)(?:\/|$)/.test(path)
  ) {
    headers.set("Cache-Control", "private, no-store");
    const vary = headers.get("Vary");
    if (!vary?.split(/,\s*/).some((v) => v.toLowerCase() === "cookie"))
      headers.set("Vary", vary ? `${vary}, Cookie` : "Cookie");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
