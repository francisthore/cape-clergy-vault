import { test, expect } from "@playwright/test";
import { origin } from "./phase42-fixtures";
test("production CSP supports hydration and rejects parser-inserted untrusted script", async ({
  page,
}) => {
  const violations: string[] = [],
    external: string[] = [];
  await page.exposeFunction("recordCspViolation", (directive: string) =>
    violations.push(directive),
  );
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (e) => {
      void (
        window as unknown as { recordCspViolation: (value: string) => Promise<void> }
      ).recordCspViolation(e.effectiveDirective);
    }),
  );
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== origin) external.push(new URL(r.url()).origin);
  });
  const response = await page.goto("/auth");
  expect(response?.status()).toBe(200);
  const headers = response!.headers(),
    csp = headers["content-security-policy"]!;
  const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["cache-control"]).toContain("no-store");
  await expect(page.getByRole("button", { name: /Sign in/i }).last()).toBeVisible();
  const scripts = await page.locator("script").evaluateAll((nodes) =>
    nodes.map((n) => ({
      nonce: (n as HTMLScriptElement).nonce,
      src: (n as HTMLScriptElement).src,
      type: (n as HTMLScriptElement).type,
    })),
  );
  expect(scripts.length).toBeGreaterThan(0);
  for (const script of scripts.filter((s) => s.type !== "application/json"))
    expect(script.nonce).toBe(nonce);
  expect(violations).toEqual([]);
  expect(external).toEqual([]);
  const parallel = await Promise.all(
    Array.from({ length: 6 }, async () => {
      const response = await page.request.get("/auth", {
        headers: { "x-cape-csp-nonce": "untrusted-client-value" },
      });
      const policy = response.headers()["content-security-policy"]!;
      const value = policy.match(/script-src 'nonce-([^']+)'/)?.[1];
      expect(value).toBeTruthy();
      expect(value).not.toBe("untrusted-client-value");
      const markup = await response.text();
      const scripts = Array.from(markup.matchAll(/<script\b([^>]*)>/g));
      expect(scripts.length).toBeGreaterThan(0);
      for (const script of scripts) expect(script[1]).toContain(`nonce="${value}"`);
      return value;
    }),
  );
  expect(new Set(parallel).size).toBe(6);
  const next = await page.request.get("/auth");
  expect(next.headers()["content-security-policy"]).not.toBe(csp);
  // Model HTML injection before parsing. strict-dynamic intentionally trusts DOM
  // scripts created by already trusted JS, including privileged test evaluation.
  await page.route(
    (url) => url.pathname === "/auth" && url.search === "?csp-probe=1",
    async (route) => {
      const original = await route.fetch();
      const markup = await original.text();
      expect(markup).toContain("</head>");
      await route.fulfill({
        response: original,
        body: markup.replace("</head>", "<script>window.__untrustedScriptRan=true</script></head>"),
      });
    },
  );
  await page.goto("/auth?csp-probe=1");
  await expect.poll(() => violations).toContain("script-src-elem");
  expect(
    await page.evaluate(
      () => (window as unknown as { __untrustedScriptRan?: boolean }).__untrustedScriptRan,
    ),
  ).toBeUndefined();
  for (const path of [
    "/account",
    "/admin",
    "/admin/access",
    "/reviewer",
    "/api/administration?view=intake",
  ]) {
    const protectedResponse = await page.request.get(path, { maxRedirects: 0 });
    expect(protectedResponse.headers()["cache-control"]).toContain("no-store");
    expect(protectedResponse.headers()["x-content-type-options"]).toBe("nosniff");
  }
});
