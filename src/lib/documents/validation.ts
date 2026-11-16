// Browser-safe policy shared with the independent streaming server checks.
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export function validatePdfSelection(file: Pick<File, "name" | "size" | "type">): string | null {
  if (file.size > MAX_PDF_BYTES)
    return "Your PDF exceeds the 20 MiB upload limit. Please choose a smaller file.";
  if (!file.size) return "This PDF is empty. Please choose a nonempty file.";
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf"))
    return "Please choose a PDF file (.pdf).";
  return null;
}
