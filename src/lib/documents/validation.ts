// Browser-safe policy shared with the independent streaming server checks.
export const MAX_PDF_BYTES = 4 * 1024 * 1024;
export function validatePdfSelection(file: Pick<File, "name" | "size" | "type">): string | null {
  if (file.size > MAX_PDF_BYTES)
    return "Your PDF exceeds the 4 MiB upload limit. Please choose a smaller file.";
  if (!file.size) return "This PDF is empty. Please choose a nonempty file.";
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf"))
    return "Please choose a PDF file (.pdf).";
  return null;
}
export function formatFileSize(bytes: number) {
  return bytes < 1024
    ? `${bytes} bytes`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
// Bounded local reads are a usability check; the server independently checks streamed bytes.
export async function validatePdfContents(file: File): Promise<string | null> {
  const metadata = validatePdfSelection(file);
  if (metadata) return metadata;
  const [header, trailer] = await Promise.all([
    file.slice(0, 16).text(),
    file.slice(Math.max(0, file.size - 1024)).text(),
  ]);
  return /^%PDF-(1\.[0-7]|2\.0)[\r\n]/.test(header) && /%%EOF\s*$/.test(trailer)
    ? null
    : "This file does not contain a recognised PDF header and end marker. Please choose a PDF.";
}
