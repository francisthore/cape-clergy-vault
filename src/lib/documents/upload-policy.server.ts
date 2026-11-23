import { MAX_PDF_BYTES } from "./validation.ts";
import type { UploadPolicy } from "./upload-policy.ts";
// Web-safe operational metadata only. No provider credentials/temporary upload targets.
// Browser metadata and environment values cannot increase the V1 ceiling.
export function configuredUploadPolicy(env: NodeJS.ProcessEnv = process.env): UploadPolicy {
  const hardMaxBytes = Number(env["CAPE_MAX_UPLOAD_BYTES"] ?? MAX_PDF_BYTES);
  const screeningMaxBytes = Number(env["CAPE_SCREENING_MAX_BYTES"] ?? MAX_PDF_BYTES);
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
