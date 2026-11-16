import { describe, expect, it } from "vitest";
import { MAX_PDF_BYTES, validatePdfSelection } from "./validation";
describe("browser PDF selection policy", () => {
  it.each([1, MAX_PDF_BYTES])("accepts %i bytes", (size) => {
    expect(
      validatePdfSelection({ name: "document.pdf", type: "application/pdf", size }),
    ).toBeNull();
  });
  it.each([
    [MAX_PDF_BYTES + 1, "document.pdf", "application/pdf", "exceeds"],
    [0, "document.pdf", "application/pdf", "empty"],
    [4, "document.doc", "application/pdf", "choose a PDF"],
    [4, "document.pdf", "application/zip", "choose a PDF"],
  ])("rejects %i bytes / %s / %s", (size, name, type, error) => {
    expect(validatePdfSelection({ name, type, size })).toContain(error);
  });
});
