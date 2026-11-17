import { MAX_PDF_BYTES } from "./validation.ts";
import type { UploadPolicy } from "./upload-policy.ts";
// Web-safe operational metadata only. No provider credentials/temporary upload targets.
// A larger value requires independently verified worker host/contract and release approval.
export function configuredUploadPolicy(env: NodeJS.ProcessEnv = process.env): UploadPolicy {
  const hardMaxBytes = Number(env["CAPE_MAX_UPLOAD_BYTES"] ?? MAX_PDF_BYTES);
  const screeningMaxBytes = Number(env["CAPE_SCREENING_MAX_BYTES"] ?? 4 * 1024 * 1024);
  if (
    ![hardMaxBytes, screeningMaxBytes].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= MAX_PDF_BYTES,
    )
  )
    throw Error("Invalid PDF upload policy");
  return {
    hardMaxBytes,
    screeningMaxBytes: Math.min(hardMaxBytes, screeningMaxBytes),
    confidentialPdfAllowed: false,
  };
}
