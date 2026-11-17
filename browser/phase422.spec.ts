import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixtures42, origin } from "./phase42-fixtures";
import { configuredEmail } from "../src/lib/email/service.server";
import { deliverReviewerNotifications } from "../src/lib/reviews/notifications.server";
import { connectLocalNotifications } from "../database/notifications.server";
let f: Awaited<ReturnType<typeof fixtures42>>;
test.beforeAll(async () => {
  f = await fixtures42();
});
test.afterAll(async () => {
  await f?.close();
});
test.beforeEach(async ({ page }) => {
  await f.paceAuth();
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/auth/account" && !response.ok())
      console.log(
        "Account check HTTP status:",
        response.status(),
        "Retry-After:",
        response.headers()["retry-after"] ?? "none",
      );
  });
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
});
test("independent managers activate reviewers and coordinate confidential review", async ({
  page,
}, info) => {
  const coordinator = f.id("approver"),
    author = f.id("pending");
  // The guarded bootstrap/recovery itself is exercised in phase422.test.ts. These
  // disposable grants represent its reviewed result; no real account IDs occur here.
  await f.owner
    .client`insert into app.operational_grants(user_id,capability,delegated) values(${coordinator},'access_manager',array['approver','review_coordinator','reviewer'])`;
  await f.owner
    .client`insert into app.operational_grants(user_id,capability) values(${coordinator},'review_coordinator')`;
  const independent = f.id("multi");
  await f.owner
    .client`insert into app.operational_grants(user_id,capability,delegated) values(${independent},'access_manager',array['reviewer']),(${independent},'review_coordinator',array[]::text[])`;
  const worker = await connectLocalNotifications();
  async function deliver(who: string, kind: string) {
    const [row] = await f.owner
      .client`select id from app.reviewer_notifications where user_id=${who} and kind=${kind} and delivered_at is null and cancelled_at is null order by created_at desc limit 1`;
    expect(row).toBeTruthy();
    expect(
      await deliverReviewerNotifications(
        worker,
        configuredEmail(
          origin,
          { NODE_ENV: "test", EMAIL_PROVIDER: "development" },
          f.owner.client,
        ),
        origin,
        "Disposable-browser-fixture-secret-Phase3F-ONLY",
        1,
        String(row!["id"]),
      ),
    ).toBe(1);
  }
  try {
    await f.login(page, "pending");
    await page.goto("/");
    await expect(
      page.getByRole("main").getByRole("link", { name: /View registration status/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("link", { name: "Register as clergy" }),
    ).toHaveCount(0);
    await expect(
      (await page.request.get(origin + "/api/administration?view=intake")).status(),
    ).toBe(403);
    await f.login(page, "approver");
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "TEFT Administration", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("main")
      .getByRole("link", { name: /Manage clergy registrations/ })
      .click();
    await page.goto("/admin/registrations/" + author);
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("button", { name: "Confirm decision", exact: true }).click();
    await expect(page.getByRole("alertdialog")).not.toBeVisible();
    await f.deliver("pending", "approved");
    await page.goto("/admin/access");
    await page.getByLabel("Exact account ID").fill(coordinator);
    await page.getByRole("button", { name: "Inspect identity" }).click();
    await expect(
      page.getByText("Mailbox: " + f.address("approver"), { exact: false }),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath("phase422-access.png"), fullPage: true });
    await page
      .getByLabel("Reason and identity verification evidence")
      .fill("Synthetic forbidden self-invitation for boundary validation.");
    await page.getByLabel(/^Type INVITE/).fill(`INVITE ${coordinator} reviewer`);
    await expect(page.getByRole("button", { name: "Confirm access operation" })).toBeDisabled();
    expect(
      (
        await page.request.post(origin + "/api/administration", {
          headers: { origin },
          data: {
            action: "access",
            operation: "invite",
            identity: coordinator,
            capability: "reviewer",
            mailbox: f.address("approver"),
            confirmation: `INVITE ${coordinator} reviewer`,
            reason: "Synthetic forbidden self-invitation",
            requestId: randomUUID(),
          },
        })
      ).status(),
    ).toBe(403);
    await f.login(page, "multi");
    await page.goto("/admin/access");
    await page.getByLabel("Exact account ID").fill(coordinator);
    await page.getByRole("button", { name: "Inspect identity" }).click();
    await expect(
      page.getByText("Mailbox: " + f.address("approver"), { exact: false }),
    ).toBeVisible();
    await page
      .getByLabel("Reason and identity verification evidence")
      .fill(
        "Synthetic exact registered identity independently verified for pilot reviewer duties.",
      );
    await page.getByLabel(/^Type INVITE/).fill(`INVITE ${coordinator} reviewer`);
    await page.getByRole("button", { name: "Confirm access operation" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Invitation queued" })).toBeVisible();
    await expect(page.getByText("pending", { exact: false }).first()).toBeVisible();
    await deliver(coordinator, "reviewer_invitation");
    const invitation = await f.capture("approver", "reviewer invitation");
    await f.login(page, "approver");
    await page.goto(invitation.text.match(/https?:\/\/[^\s]+/)![0]!);
    await expect(page).not.toHaveURL(/#token=/);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Accept reviewer invitation" }).click();
    await expect(page.getByRole("status")).toContainText("Reviewer invitation accepted");
    await f.login(page, "pending");
    await page.goto("/");
    await expect(
      page.getByRole("main").getByRole("link", { name: /Create a submission/ }),
    ).toBeVisible();
    await page
      .getByRole("main")
      .getByRole("link", { name: /Create a submission/ })
      .click();
    await page.getByLabel("Submission type").selectOption("idea");
    await page
      .getByLabel("Title", { exact: true })
      .fill("Synthetic confidential theological proposal");
    await page
      .getByLabel("Abstract or description")
      .fill("A meaningful theological proposal prepared for disposable browser acceptance.");
    await page.getByRole("checkbox", { name: /Confidential/ }).check();
    await page.getByRole("button", { name: "Save resource details" }).click();
    await expect(page).toHaveURL(/\/submissions\/[0-9a-f-]+$/);
    const submissionId = page.url().split("/").at(-1)!;
    await expect(page.getByRole("button", { name: "Send to TEFT for review" })).toBeEnabled();
    await page.getByRole("button", { name: "Send to TEFT for review" }).click();
    await page.getByRole("button", { name: "Confirm submission" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Your resource has been sent to TEFT. It is awaiting assignment for theological review.",
    );
    await expect(page.getByText("Awaiting reviewer assignment", { exact: true })).toBeVisible();
    await deliver(author, "submission_received");
    await deliver(coordinator, "submission_intake");
    expect((await f.capture("pending", "your resource has been received")).text).not.toContain(
      "Synthetic confidential",
    );
    await f.login(page, "approver");
    await page.goto("/admin/intake");
    const resource = page
      .locator("section")
      .filter({ has: page.getByText("Reference: " + submissionId, { exact: true }) });
    await expect(
      resource.getByRole("heading", { name: "Confidential resource", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Synthetic confidential theological proposal", { exact: true }),
    ).toHaveCount(0);
    const violations = (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()
    ).violations;
    expect(violations).toEqual([]);
    await page.screenshot({ path: info.outputPath("phase422-intake.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(
      resource.getByLabel("Eligible reviewer").locator(`option[value="${coordinator}"]`),
    ).toHaveJSProperty("disabled", true);
    expect(
      (
        await page.request.post(origin + "/api/administration", {
          headers: { origin },
          data: {
            action: "assign",
            id: submissionId,
            revision: 1,
            reviewerId: coordinator,
            requestId: randomUUID(),
          },
        })
      ).status(),
    ).toBe(403);
    await f.login(page, "multi");
    await page.goto("/admin/intake");
    await resource.getByLabel("Eligible reviewer").selectOption(coordinator);
    await resource.getByRole("button", { name: "Assign reviewer", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("revision 1");
    await page.getByRole("button", { name: "Confirm operation" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Reviewer assigned" })).toBeVisible();
    await deliver(coordinator, "review_assigned");
    await f.login(page, "approver");
    await page.goto("/reviewer/submissions/" + submissionId);
    await expect(
      page.getByRole("heading", {
        name: "Synthetic confidential theological proposal",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start review", exact: true }).click();
    await page
      .getByLabel("Private reviewer notes", { exact: true })
      .fill("Private synthetic rationale: the proposal satisfies the theological review criteria.");
    await page.getByRole("button", { name: "Accept submission", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /Confirm/ })
      .click();
    await expect(page.getByRole("alertdialog")).not.toBeVisible();
    await deliver(author, "submission_accepted");
    await f.login(page, "pending");
    await page.goto("/submissions/" + submissionId);
    await expect(page.getByText("Accepted for sharing where permitted").first()).toBeVisible();
    const detail = await (
      await page.request.get(origin + "/api/submissions?id=" + submissionId)
    ).text();
    expect(detail).not.toContain("Private synthetic rationale");
    await page.goto("/admin/access");
    await expect(
      page.getByText("Current delegated access-management authorization is required."),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("phase422-author-accepted.png"),
      fullPage: true,
    });
  } finally {
    await worker.close();
  }
});
