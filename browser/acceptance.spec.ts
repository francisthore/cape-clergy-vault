import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixtures, password } from "./fixtures";
let f: Awaited<ReturnType<typeof fixtures>>;
test.beforeAll(async () => {
  f = await fixtures();
});
test.afterAll(async () => {
  await f?.cleanup();
});
async function assess(page: Page) {
  await expect(
    page.getByRole("status").filter({ hasText: /^(Loading|Checking invitation)/ }),
  ).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    );
  });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  ).toEqual([]);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth
      ? []
      : [...document.querySelectorAll("main,main *")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
          })
          .map((el) => ({ tag: el.tagName, id: el.id, class: el.className })),
  );
  expect(overflow).toEqual([]);
}
async function logout(page: Page) {
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(
    (url) => url.pathname === "/auth" && url.searchParams.get("view") === "login",
  );
}
async function confirmDecision(page: Page, action: string) {
  await page.getByRole("button", { name: action, exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await page.getByRole("alertdialog").evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await assess(page);
  await page.getByRole("button", { name: "Confirm decision", exact: true }).click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
}
test("registration, captured verification, login, pending feedback, logout and password recovery", async ({
  page,
}) => {
  const live = await page.request.get("/health/live");
  expect(await live.json()).toEqual({ status: "live" });
  const ready = await page.request.get("/health/ready");
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: "degraded" });
  await page.goto("/auth?view=register");
  await assess(page);
  await page.getByLabel("Clergy title", { exact: true }).fill("Rev.");
  await page.getByLabel("Full name", { exact: true }).fill("Disposable registration");
  await page.getByLabel("Parish or ministry", { exact: true }).fill("Test parish");
  await page.getByLabel("Email address", { exact: true }).fill(f.address("new"));
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(/email|verify/i);
  await f.registered("new");
  const mail = await f.capture("new", "verify");
  const verification = mail.text.match(/https?:\/\/[^\s]+/)![0]!;
  await page.goto(verification);
  await expect(page.getByRole("status")).toContainText("verified");
  await assess(page);
  await f.login(page, "new");
  await expect(page.getByRole("status")).toContainText("awaiting Diocese approval");
  await assess(page);
  await logout(page);
  await assess(page);
  await page.goto("/auth?view=forgot");
  await page.getByLabel("Email address", { exact: true }).fill(f.address("new"));
  await page.getByRole("button", { name: "Send reset email" }).click();
  const reset = await f.capture("new", "reset");
  await page.goto(reset.text.match(/https?:\/\/[^\s]+/)![0]!);
  await page.getByLabel("Password", { exact: true }).fill(password + " reset");
  await page.getByLabel("Confirm password", { exact: true }).fill(password + " reset");
  await assess(page);
  await page.getByRole("button", { name: "Reset password", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("has been reset");
  await f.login(page, "new", password + " reset");
});
test("approver decisions, suspension, settings capability and validation", async ({ page }) => {
  await f.login(page, "reader");
  let response = await page.goto("/admin/registrations");
  expect(response?.status()).toBe(403);
  response = await page.goto("/admin/settings/email");
  expect(response?.status()).toBe(403);
  await logout(page);
  await f.login(page, "approver");
  await page.goto("/admin/registrations");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await assess(page);
  await page.goto("/admin/registrations/" + f.id("pending"));
  await expect(page.getByText("Status: pending", { exact: true })).toBeVisible();
  await assess(page);
  await confirmDecision(page, "Approve");
  await expect(page.getByText("Status: approved", { exact: true })).toBeVisible();
  await page
    .getByLabel("Decision reason", { exact: false })
    .fill("Disposable suspension acceptance test");
  await confirmDecision(page, "Suspend");
  await expect(page.getByText("Status: suspended", { exact: true })).toBeVisible();
  await page.goto("/admin/registrations/" + f.id("rejected"));
  await page
    .getByLabel("Decision reason", { exact: false })
    .fill("Disposable rejection acceptance test");
  await confirmDecision(page, "Reject");
  await expect(page.getByText("Status: rejected", { exact: true })).toBeVisible();
  await logout(page);
  expect((await f.signIn(page, "pending")).status()).toBe(401);
  await expect(page.getByRole("alert")).toContainText(/Sign-in failed.*account status/i);
  await assess(page);
  await f.login(page, "manager");
  await page.goto("/admin/settings/email");
  await expect(page.getByLabel("From display name")).toBeVisible();
  await assess(page);
  await page.getByLabel("From display name").fill("Disposable browser sender");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Email settings saved." })).toBeVisible();
  await page.getByLabel("Sending domain", { exact: true }).fill("unauthorized.example.invalid");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(/invalid|domain|sender/i);
  await assess(page);
});
test("quarantine, exact revision review, author feedback and repository download", async ({
  page,
}) => {
  await f.login(page, "author", password, true);
  await page.goto("/submissions/new");
  await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible();
  await assess(page);
  const title = "Disposable browser theological resource";
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("Abstract or description")
    .fill("A meaningful theological description for disposable browser acceptance testing.");
  await page.getByLabel("Keywords", { exact: false }).fill("browser, phase3f");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForURL(/\/submissions\/[0-9a-f-]+$/);
  const id = page.url().split("/").at(-1)!;
  await page.getByRole("button", { name: "Edit draft" }).click();
  await page
    .getByLabel("Abstract or description")
    .fill("An edited theological description with supporting sources for disposable testing.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("button", { name: "Edit draft" })).toBeVisible();
  await page.getByLabel("Attach a PDF", { exact: false }).setInputFiles({
    name: "disposable.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nDisposable acceptance PDF\n%%EOF\n"),
  });
  await expect(page.getByText("Security checks pending", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit for review", exact: true })).toBeDisabled();
  await assess(page);
  const [d] = await f.owner.client`select id from app.documents where submission_id=${id}`;
  await f.scan(String(d!["id"]));
  await expect(page.getByRole("link", { name: "Download PDF", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit for review", exact: true }).click();
  await page.getByRole("button", { name: "Confirm submission", exact: true }).click();
  await expect(page.getByText("Submitted for review.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit draft" })).not.toBeVisible();
  await page.goto("/submissions");
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
  await assess(page);
  await page.context().clearCookies();
  await f.login(page, "reviewer", password, true);
  const proof = await f.invite();
  await page.addInitScript((token) => {
    if (location.pathname === "/reviewer/invitation")
      history.replaceState(history.state, "", location.pathname + "#token=" + token);
  }, proof);
  await page.goto("/reviewer/invitation");
  await expect(
    page.getByRole("button", { name: "Accept reviewer invitation", exact: true }),
  ).toBeDisabled();
  await assess(page);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Accept reviewer invitation", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open reviewer workspace" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await f.assign(id);
  await page.goto("/reviewer");
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
  await assess(page);
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("button", { name: "Start review" })).toBeVisible();
  await assess(page);
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByRole("button", { name: "Return for amendment" })).toBeVisible();
  const feedback =
    "Please expand the theological argument and include the supporting references. " +
    "Additional author guidance. ".repeat(20);
  await page.getByLabel("Feedback for the author", { exact: true }).fill(feedback);
  await page
    .getByLabel("Private reviewer notes", { exact: true })
    .fill("PRIVATE FIXTURE NOTES NEVER AUTHOR VISIBLE");
  await confirmDecision(page, "Return for amendment");
  await page.context().clearCookies();
  await f.login(page, "author", password, true);
  await page.goto("/submissions/" + id);
  await expect(page.getByText(feedback, { exact: true })).toBeVisible();
  await expect(
    page.getByText("PRIVATE FIXTURE NOTES NEVER AUTHOR VISIBLE", { exact: true }),
  ).toHaveCount(0);
  await assess(page);
  await page.getByRole("button", { name: "Start an amended draft" }).click();
  await expect(page.getByRole("button", { name: "Edit draft" })).toBeVisible();
  await page.getByRole("button", { name: "Submit for review", exact: true }).click();
  await page.getByRole("button", { name: "Confirm submission", exact: true }).click();
  await expect(page.getByText("Submitted for review.", { exact: true })).toBeVisible();
  await f.assign(id);
  await page.context().clearCookies();
  await f.login(page, "reviewer", password, true);
  await page.goto("/reviewer/submissions/" + id);
  await page.getByRole("button", { name: "Start review" }).click();
  await page
    .getByLabel("Private reviewer notes", { exact: true })
    .fill("The revised argument satisfies the theological acceptance criteria.");
  await confirmDecision(page, "Accept submission");
  await page.context().clearCookies();
  await f.login(page, "reader", password, true);
  await page.goto("/repository");
  await page.getByLabel("Search", { exact: true }).fill(title);
  await page.getByLabel("Category", { exact: false }).selectOption("General");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
  await assess(page);
  await page.getByRole("link", { name: title, exact: true }).click();
  await assess(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download PDF", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("disposable.pdf");
  expect(await download.failure()).toBeNull();
  // Same accepted revision becomes confidential through trusted isolated fixture preparation.
  await f.owner.client`update app.submissions set confidential=true where id=${id}`;
  await page.reload();
  await expect(page.getByRole("status")).toContainText(/unavailable|denied/i);
  await assess(page);
});

test("shared mail limits resist forged IP headers and expired sessions lose access", async ({
  page,
  browser,
}) => {
  const address = f.address("phase4-rate-probe");
  const send = (headers: Record<string, string> = {}) =>
    page.request.post("/api/auth/send-verification-email", {
      headers: { origin: "http://localhost:3220", ...headers },
      data: { email: address },
    });
  const first = await send();
  expect(first.status()).toBe(200);
  const other = await browser.newContext();
  try {
    const limited = await other.request.post(
      "http://localhost:3220/api/auth/send-verification-email",
      {
        headers: { origin: "http://localhost:3220", "x-forwarded-for": "198.51.100.77" },
        data: { email: address },
      },
    );
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
    expect(
      (await send({ "x-forwarded-for": "198.51.100.88", "x-real-ip": "198.51.100.88" })).status(),
    ).toBe(429);
  } finally {
    await other.close();
  }
  await f.login(page, "reader");
  await f.owner
    .client`update auth.sessions set expires_at=(now() at time zone 'UTC')-interval '1 second' where user_id=${f.id("reader")}`;
  const account = await page.request.get("/api/auth/account");
  expect(await account.json()).toEqual({ status: "signed-out" });
  expect((await page.request.get("/api/repository")).status()).toBe(403);
  await page.goto("/account");
  await expect(page.getByRole("link", { name: /sign in/i }).first()).toBeVisible();
  await assess(page);
});
