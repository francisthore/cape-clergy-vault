// @vitest-environment node
import { it, expect } from "vitest";
import { newCspNonce, secureResponse } from "./headers.server";
it("sets nonce-only scripts, framing controls and no-store including early errors", () => {
  const nonce = newCspNonce();
  expect(nonce).not.toBe(newCspNonce());
  const response = secureResponse(
    new Response("error", { status: 403, headers: { "Content-Type": "text/html" } }),
    new Request("https://example.invalid/admin"),
    nonce,
  );
  const policy = response.headers.get("Content-Security-Policy")!;
  expect(policy).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic'`);
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).not.toContain("unsafe-eval");
  expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  expect(response.headers.has("Strict-Transport-Security")).toBe(false);
});
it("preserves document sandbox and appends Cookie to existing Vary", () => {
  const response = secureResponse(
    new Response("pdf", {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        Vary: "Accept-Encoding",
      },
    }),
    new Request("https://example.invalid/api/documents"),
    newCspNonce(),
  );
  expect(response.headers.get("Content-Security-Policy")).toBe("sandbox; default-src 'none'");
  expect(response.headers.get("Vary")).toBe("Accept-Encoding, Cookie");
});
