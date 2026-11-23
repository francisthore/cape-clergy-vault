import { formatFileSize } from "./validation.ts";
export type UploadPolicy = {
  hardMaxBytes: number;
  screeningMaxBytes: number;
  confidentialPdfAllowed: boolean;
};
export function screeningGuidance(policy: UploadPolicy, confidential: boolean): string {
  return confidential && !policy.confidentialPdfAllowed
    ? "Confidential PDFs cannot currently be screened through an approved route. Keep your draft without a PDF and contact TEFT. Do not remove confidentiality to enable upload."
    : `Maximum ${formatFileSize(policy.screeningMaxBytes).replace(".00 MiB", " MiB")} per PDF. For longer works, prepare clearly labelled parts locally and attach each PDF separately. Bouncer receives the complete file for malware screening.${confidential ? " Accepted confidential work stays outside the shared repository." : ""}`;
}
export function screeningSelectionError(size: number, policy: UploadPolicy, confidential: boolean) {
  return (confidential && !policy.confidentialPdfAllowed) || size > policy.screeningMaxBytes
    ? screeningGuidance(policy, confidential)
    : null;
}
