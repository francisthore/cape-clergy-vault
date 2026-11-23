// @vitest-environment node
import { describe, it, expect } from "vitest";
import { configuredUploadPolicy } from "./upload-policy.server";
import { screeningSelectionError } from "./upload-policy";
import { MAX_PDF_BYTES } from "./validation";
describe("server-authoritative operational PDF policy", () => {
  it("keeps 4 MiB hard maximum and defaults to the verified small-file route", () => {
    const policy = configuredUploadPolicy({});
    expect(policy.hardMaxBytes).toBe(MAX_PDF_BYTES);
    for (const size of [1, 4194303, 4194304])
      expect(screeningSelectionError(size, policy, false)).toBeNull();
    for (const size of [4194305, 20971520])
      expect(screeningSelectionError(size, policy, false)).toContain("per PDF");
    expect(screeningSelectionError(1, policy, true)).toContain("Do not remove confidentiality");
  });
  it("accepts only trusted integer limits within the hard ceiling and never enables confidential processing", () => {
    for (const value of ["NaN", "0", "-1", "4194304.5", String(MAX_PDF_BYTES + 1)])
      expect(() => configuredUploadPolicy({ CAPE_SCREENING_MAX_BYTES: value })).toThrow();
    const policy = configuredUploadPolicy({ CAPE_SCREENING_MAX_BYTES: String(MAX_PDF_BYTES) });
    expect(screeningSelectionError(MAX_PDF_BYTES, policy, false)).toBeNull();
    expect(screeningSelectionError(1, policy, true)).not.toBeNull();
    expect(configuredUploadPolicy({ CAPE_MAX_UPLOAD_BYTES: "100" }).screeningMaxBytes).toBe(100);
  });
});
