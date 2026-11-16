import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixtures42, origin, password } from "./phase42-fixtures";
import { MAX_PDF_BYTES } from "../src/lib/documents/validation";
let f: Awaited<ReturnType<typeof fixtures42>>;
test.beforeAll(async () => {
  f = await fixtures42();
});
test.afterAll(async () => {
  await f?.close();
});
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.log("Browser error:", error.message));
  // No browser-origin external requests, including font providers, during acceptance.
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
});
async function menu(page: Page) {
  const button = page.getByRole("button", { name: "Menu", exact: true });
  if ((await button.isVisible()) && (await button.getAttribute("aria-expanded")) === "false")
    await button.click();
  return page.getByRole("navigation", { name: "Main navigation" });
}
async function assess(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()
    ).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
test("visitor, genuine local crest assets, privacy dialog keyboard access and retained registration inputs", async ({
  page,
}) => {
  await page.goto("/");
  const nav = await menu(page);
  await expect(nav.getByRole("link", { name: "Register", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "My submissions" })).toHaveCount(0);
  await expect(page.locator("header img")).toHaveJSProperty("naturalWidth", 140);
  for (const path of [
    "/favicon.png",
    "/apple-touch-icon.png",
    "/app-icon-192.png",
    "/app-icon-512.png",
    "/manifest.webmanifest",
  ])
    expect((await page.request.get(path)).status()).toBe(200);
  await nav.getByRole("link", { name: "Register", exact: true }).click();
  await page.getByLabel("Full name", { exact: true }).fill("Synthetic retained name");
  const trigger = page.getByRole("button", { name: "Privacy Notice (Version 1)", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Privacy Notice (Version 1)", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Proposed for Diocese approval");
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((el) => el.contains(window.document.activeElement))).toBe(true);
  }
  expect(await dialog.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await assess(page);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Synthetic retained name",
  );
  await trigger.click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  expect(
    await page
      .getByRole("checkbox")
      .evaluate((el: HTMLInputElement) => el.required && !el.checkValidity()),
  ).toBe(true);
  await assess(page);
});
test("register, verify captured mail, pending account, approver dashboard and captured approval outcome", async ({
  page,
}) => {
  await page.goto("/auth?view=register");
  await page.getByLabel("Clergy title", { exact: true }).fill("Rev.");
  await page.getByLabel("Full name", { exact: true }).fill("Synthetic new registration");
  await page.getByLabel("Parish or ministry", { exact: true }).fill("Synthetic parish");
  await page.getByLabel("Email address", { exact: true }).fill(f.address("new"));
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("email");
  await f.registered("new");
  const verification = await f.capture("new", "verify");
  await page.goto(verification.text.match(/https?:\/\/[^\s]+/)![0]!);
  await expect(page.getByRole("status")).toContainText("verified");
  await f.deliver("approver", "registration_pending_alert");
  expect((await f.capture("approver", "awaiting review")).text).toContain("/admin/registrations");
  await f.login(page, "new");
  await expect(page.getByRole("status")).toContainText("awaiting Diocese approval");
  let nav = await menu(page);
  await expect(nav.getByRole("link", { name: "My account", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Repository", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Register", exact: true })).toHaveCount(0);
  await assess(page);
  await page.context().clearCookies();
  await f.login(page, "approver");
  await page.goto("/admin/registrations");
  await page.getByLabel("Search", { exact: false }).fill(f.address("new"));
  await page.getByRole("button", { name: /apply|search/i }).click();
  await page.getByRole("link", { name: /Synthetic new registration/ }).click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Confirm decision", exact: true }).click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  await f.deliver("new", "approved");
  expect((await f.capture("new", "approved")).text).toContain(
    "clergy registration has been approved",
  );
  await page.context().clearCookies();
  await f.login(page, "new");
  nav = await menu(page);
  await expect(nav.getByRole("link", { name: "My submissions", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Repository", exact: true })).toBeVisible();
});
test("capabilities combine without duplicates, refresh fails closed, expiry and logout clear links", async ({
  page,
}) => {
  await f.login(page, "multi");
  let nav = await menu(page);
  for (const name of [
    "Home",
    "My submissions",
    "Repository",
    "Manage registrations",
    "Reviewer workspace",
    "Email settings",
    "My account",
  ])
    await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(1);
  await assess(page);
  for (const [path, heading] of [
    ["/submissions", "My submissions"],
    ["/repository", "Clergy repository"],
    ["/reviewer", "Theological review"],
    ["/admin/settings/email", "Application email settings"],
  ]) {
    await page.goto(path!);
    await expect(page.getByRole("heading", { name: heading!, exact: true })).toBeVisible();
    await assess(page);
  }
  await page.goto("/account");
  nav = await menu(page);
  await page.route("**/api/auth/account", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"message":"Synthetic outage"}',
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(nav).toContainText("Account check unavailable");
  await expect(nav.getByRole("link", { name: "Reviewer workspace" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Register", exact: true })).toHaveCount(0);
  await page.unroute("**/api/auth/account");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(nav.getByRole("link", { name: "Reviewer workspace" })).toBeVisible();
  await f.owner
    .client`update app.role_assignments set revoked_at=now() where user_id=${f.id("multi")} and role='approver'`;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(nav.getByRole("link", { name: "Manage registrations" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Reviewer workspace" })).toBeVisible();
  await nav.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(
    (url) => url.pathname === "/auth" && url.searchParams.get("view") === "login",
  );
  nav = await menu(page);
  await expect(nav.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  expect((await page.request.get("/api/submissions")).status()).toBe(403);
  await f.login(page, "pending");
  nav = await menu(page);
  await f.owner
    .client`update auth.sessions set expires_at=(now() at time zone 'UTC')-interval '1 second' where user_id=${f.id("pending")}`;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(nav.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
});
test("visible PDF picker, editor selection, zero invalid upload requests, quarantine, mocked Bouncer, review and private streaming", async ({
  page,
}) => {
  await f.login(page, "author");
  await page.goto("/submissions/new");
  await expect(
    page.getByText("Save your initial information first.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Synthetic Phase42 theological resource");
  await page
    .getByLabel("Abstract or description", { exact: true })
    .fill("Synthetic meaningful description for a harmless PDF browser acceptance journey.");
  await page.getByRole("button", { name: "Save resource details", exact: true }).click();
  await page.waitForURL(/\/submissions\/[0-9a-f-]+$/);
  const submission = page.url().split("/").at(-1)!;
  const input = page.getByLabel("Attach a PDF", { exact: false });
  const upload = page.getByRole("button", { name: "Upload PDF", exact: true });
  let requests = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/documents") requests++;
  });
  for (const [name, buffer, mime, expected] of [
    ["oversized.pdf", Buffer.alloc(MAX_PDF_BYTES + 1), "application/pdf", "exceeds"],
    ["empty.pdf", Buffer.alloc(0), "application/pdf", "empty"],
    ["text.txt", Buffer.from("plain text"), "text/plain", "choose a PDF"],
    ["fake.pdf", Buffer.from("plain text"), "application/pdf", "header and end marker"],
  ] as const) {
    await input.setInputFiles({ name, buffer, mimeType: mime });
    await expect(page.locator("#pdf-error")).toContainText(expected);
    await expect(upload).toHaveCount(0);
  }
  expect(requests).toBe(0);
  const dropped = await page.evaluateHandle((max) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(max + 1)], "large.pdf", { type: "application/pdf" }));
    return dt;
  }, MAX_PDF_BYTES);
  await page.locator(".upload-area").dispatchEvent("drop", { dataTransfer: dropped });
  await dropped.dispose();
  await expect(page.locator("#pdf-error")).toContainText("exceeds");
  expect(requests).toBe(0);
  const exactLimitPdf = Buffer.alloc(MAX_PDF_BYTES);
  exactLimitPdf.write("%PDF-1.4\n");
  exactLimitPdf.write("\n%%EOF\n", exactLimitPdf.length - 7);
  await input.setInputFiles({
    name: "exact-limit.pdf",
    mimeType: "application/pdf",
    buffer: exactLimitPdf,
  });
  await expect(upload).toBeEnabled();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Edit submission", exact: true }).click();
  await expect(input).toBeEnabled();
  const picker = page.waitForEvent("filechooser");
  const choosePdf = page.getByRole("button", { name: "Choose PDF", exact: true });
  if (test.info().project.use.hasTouch) await choosePdf.tap();
  else await choosePdf.click();
  const chooser = await picker;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const pdf = Buffer.from("%PDF-1.4\nSynthetic harmless Phase42 browser PDF\n%%EOF\n");
  await chooser.setFiles({ name: "synthetic.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByText("synthetic.pdf", { exact: false })).toBeVisible();
  await expect(upload).toBeDisabled();
  await expect(
    page.getByText("Save your changes or close the editor", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  // File-picker focus must also preserve the input outside the editor.
  const original = await input.elementHandle();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(await original!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(upload).toBeEnabled();
  await upload.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByText("Upload complete.", { exact: false })).toBeVisible();
  expect(requests).toBe(1);
  const [document] = await f.owner
    .client`select id,state from app.documents where submission_id=${submission}`;
  expect(document!["state"]).toBe("quarantined");
  expect((await page.request.get(`/api/documents/${document!["id"]}/download`)).status()).toBe(404);
  await expect(page.getByRole("link", { name: "Download PDF" })).toHaveCount(0);
  await expect(page.getByText("Awaiting verification", { exact: true })).toBeVisible();
  await assess(page);
  await page.locator("main").focus();
  await page.screenshot({ path: test.info().outputPath("submission-waiting.png"), fullPage: true });
  await page.getByRole("button", { name: "Edit submission", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Unsaved title retained through scan polling");
  await f.scan(String(document!["id"]));
  // Read-only polling updates attachment evidence while the editor stays mounted.
  await expect(page.getByText("Ready for submission", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Unsaved title retained through scan polling",
  );
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
  await page.locator("main").focus();
  await page.screenshot({ path: test.info().outputPath("submission-ready.png"), fullPage: true });
  await page.getByRole("button", { name: "Send to TEFT for review", exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toBeVisible();
  await page.keyboard.press("Tab");
  expect(await confirmation.evaluate((el) => el.contains(window.document.activeElement))).toBe(
    true,
  );
  await page.getByRole("button", { name: "Confirm submission", exact: true }).click();
  await expect(
    page.getByText("Sent to TEFT for theological review.", { exact: true }),
  ).toBeVisible();
  await f.owner
    .client`select app.reviewer_operator('assign',${f.id("multi")},${submission},null,null,${"ASSIGN " + f.id("multi") + " " + submission + " REVISION 1"},1)`;
  await page.context().clearCookies();
  await f.login(page, "multi");
  await page.goto(`/reviewer/submissions/${submission}`);
  await page.getByRole("button", { name: "Start review", exact: true }).click();
  await page
    .getByLabel("Private reviewer notes", { exact: true })
    .fill("Synthetic private assessment supporting theological acceptance.");
  await page.getByRole("button", { name: "Accept submission", exact: true }).click();
  await page.getByRole("button", { name: "Confirm decision", exact: true }).click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  await page.context().clearCookies();
  await f.login(page, "author");
  await page.goto(`/submissions/${submission}`);
  await expect(
    page.getByText("Accepted for sharing where permitted", { exact: true }),
  ).toBeVisible();
  const detail = await (await page.request.get(`/api/submissions?id=${submission}`)).text();
  expect(detail).not.toContain("Synthetic private assessment");
  const download = await page.request.get(`/api/documents/${document!["id"]}/download`);
  expect(download.status()).toBe(200);
  expect(await download.body()).toEqual(pdf);
  await assess(page);
});

test("waiting, active, delayed and failed checks remain gated, exclusion confirms retained history", async ({
  page,
}) => {
  await f.login(page, "author");
  const saved = await page.request.post("/api/submissions", {
    headers: { origin },
    data: {
      action: "save",
      version: 0,
      kind: "document",
      title: "Synthetic verification status journey",
      category: "General",
      abstract: "A meaningful description for the verification status acceptance checks.",
      keywords: [],
      confidential: false,
    },
  });
  expect(saved.status()).toBe(200);
  const { id } = await saved.json();
  const pdf = Buffer.from("%PDF-1.4\nHarmless verification fixture\n%%EOF\n");
  const uploaded = await page.request.post(
    `/api/documents?submissionId=${id}&requestId=${crypto.randomUUID()}`,
    {
      headers: { origin, "content-type": "application/pdf", "x-document-name": "verification.pdf" },
      data: pdf,
    },
  );
  expect(uploaded.status()).toBe(201);
  await page.goto(`/submissions/${id}`);
  await expect(page.getByText("Awaiting verification", { exact: true })).toBeVisible();
  await assess(page);
  const [doc] = await f.owner.client`select id from app.documents where submission_id=${id}`;
  const documentId = String(doc!["id"]);
  // Only disposable fixture state changes. Production transition functions and
  // no-network worker behavior are independently checked by the database suites.
  for (const [state, jobState, expected] of [
    ["scanning", "scanning", "Being checked"],
    ["quarantined", "queued", "Taking longer than expected"],
    ["scan_failed", "exhausted", "Verification unsuccessful"],
  ] as const) {
    await f.owner.client`update app.documents set state=${state} where id=${documentId}`;
    await f.owner
      .client`update app.document_scans set state=${jobState}, lease_token=case when ${jobState}='scanning' then gen_random_uuid() else null end, lease_until=case when ${jobState}='scanning' then now()+interval '5 minutes' else null end, error_category=case when ${expected}='Taking longer than expected' then 'unavailable' else null end where document_id=${documentId}`;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText(expected, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send to TEFT for review", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("link", { name: "Download PDF", exact: true })).toHaveCount(0);
    expect((await page.request.get(`/api/documents/${documentId}/download`)).status()).toBe(404);
    await expect(page.getByRole("progressbar")).toHaveCount(0);
  }
  await assess(page);
  await page.getByRole("button", { name: "Exclude attachment", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("not permanently deleted");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Exclude attachment", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Exclude attachment", exact: true }).click();
  await page.getByRole("button", { name: "Confirm exclusion", exact: true }).click();
  await expect(page.getByText("Excluded from this revision", { exact: true })).toBeVisible();
  expect(
    (await f.owner.client`select excluded from app.documents where id=${documentId}`)[0]![
      "excluded"
    ],
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Send to TEFT for review", exact: true }),
  ).toBeDisabled();
  await assess(page);
});
