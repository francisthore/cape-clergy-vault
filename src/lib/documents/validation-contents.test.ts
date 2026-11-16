// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { validatePdfContents, MAX_PDF_BYTES } from "./validation";
describe("bounded local PDF content checks", () => {
  it("accepts a synthetic PDF; rejects renamed text and missing trailer", async () => {
    expect(
      await validatePdfContents(
        new File(["%PDF-1.4\nSynthetic PDF\n%%EOF\n"], "file.pdf", { type: "application/pdf" }),
      ),
    ).toBeNull();
    for (const text of ["text masquerading as PDF", "%PDF-1.4\nmissing end marker"])
      expect(
        await validatePdfContents(new File([text], "fake.pdf", { type: "application/pdf" })),
      ).toContain("header and end marker");
  });
  it("rejects oversized metadata before reading bytes", async () => {
    const slice = vi.fn();
    expect(
      await validatePdfContents({
        name: "large.pdf",
        type: "application/pdf",
        size: MAX_PDF_BYTES + 1,
        slice,
      } as unknown as File),
    ).toContain("exceeds");
    expect(slice).not.toHaveBeenCalled();
  });
});
