import { formatFileSize } from "./validation.ts";
export type UploadPolicy = {
  hardMaxBytes: number;
  screeningMaxBytes: number;
  confidentialPdfAllowed: false;
};
export function screeningGuidance(policy: UploadPolicy, confidential: boolean): string {
  return confidential
    ? "Confidential PDFs cannot currently be screened through an approved route. Keep your draft without a PDF and contact TEFT. Do not remove confidentiality to enable upload."
    : `Current PDF screening limit: ${formatFileSize(policy.screeningMaxBytes)}. Larger PDFs cannot currently be verified. Choose a smaller PDF or keep your draft and contact TEFT. The application safety maximum remains 20 MiB.`;
}
export function screeningSelectionError(size: number, policy: UploadPolicy, confidential: boolean) {
  return confidential || size > policy.screeningMaxBytes
    ? screeningGuidance(policy, confidential)
    : null;
}
