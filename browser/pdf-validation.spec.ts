import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixtures } from "./fixtures";
import { MAX_PDF_BYTES } from "../src/lib/documents/validation";
let f: Awaited<ReturnType<typeof fixtures>>;
test.beforeAll(async () => {
  f = await fixtures();
});
test.afterAll(async () => {
  await f?.cleanup();
});

test("PDF selection validates size, empty/type, drop, replacement, accessible feedback and duplicate clicks", async ({
  page,
}) => {
  await f.login(page, "author");
  await page.goto("/submissions/new");
  await page.getByLabel("Title", { exact: true }).fill("Disposable PDF boundary validation");
  await page
    .getByLabel("Abstract or description")
    .fill("A meaningful description for disposable PDF selection validation.");
  await page.getByRole("button", { name: "Save resource details" }).click();
  await page.waitForURL(/\/submissions\/[0-9a-f-]+$/);
  const id = page.url().split("/").at(-1)!;
  const file = page.getByLabel("Attach a PDF", { exact: false });
  const upload = page.getByRole("button", { name: "Upload PDF", exact: true });
  let requests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/documents")
      requests++;
  });
  await expect(upload).toHaveCount(0);
  await expect(page.getByText("Maximum 20 MiB.", { exact: false })).toBeVisible();
  for (const [name, size, mime, message] of [
    ["oversize.pdf", MAX_PDF_BYTES + 1, "application/pdf", "exceeds the 20 MiB"],
    ["empty.pdf", 0, "application/pdf", "empty"],
    ["invalid.txt", 10, "text/plain", "choose a PDF"],
  ] as const) {
    await file.setInputFiles({ name, mimeType: mime, buffer: Buffer.alloc(size) });
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(file).toHaveAttribute("aria-invalid", "true");
    await expect(file).toHaveAttribute("aria-describedby", "pdf-limit pdf-error");
    await expect(upload).toHaveCount(0);
  }
  const exact = Buffer.alloc(MAX_PDF_BYTES);
  exact.write("%PDF-1.4\n");
  exact.write("\n%%EOF\n", exact.length - 7);
  // Exercise the same input used by native mobile selection and replacement after rejection.
  await file.setInputFiles({
    name: "exact.pdf",
    mimeType: "application/pdf",
    buffer: exact,
  });
  await expect(upload).toBeEnabled();
  await expect(page.getByRole("alert")).toBeEmpty();
  const transfer = await page.evaluateHandle((max) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(max + 1)], "dropped.pdf", { type: "application/pdf" }));
    return dt;
  }, MAX_PDF_BYTES);
  await page.locator(".upload-area").dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
  await expect(page.getByRole("alert")).toContainText("exceeds the 20 MiB");
  await expect(upload).toHaveCount(0);
  // A full browser event cycle plus a database query proves rejection creates no upload or reservation.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(requests).toBe(0);
  expect(
    (
      await f.owner.client`select count(*)::int as n from app.documents where submission_id=${id}`
    )[0]!["n"],
  ).toBe(0);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations.map((v) => v.id)).toEqual([]);
  await file.setInputFiles({
    name: "valid.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nDisposable selection fixture\n%%EOF\n"),
  });
  await expect(upload).toBeEnabled();
  // Dispatch both clicks in one task, before React can commit the disabled state.
  await upload.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByText("Awaiting verification", { exact: false })).toBeVisible();
  expect(requests).toBe(1);
  expect(
    (
      await f.owner.client`select count(*)::int as n from app.documents where submission_id=${id}`
    )[0]!["n"],
  ).toBe(1);
});
