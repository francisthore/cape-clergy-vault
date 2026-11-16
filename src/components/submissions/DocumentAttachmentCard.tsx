import { FileText, CheckCircle2, Clock3, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { documentStatus, type Attachment } from "@/lib/documents/status";
import { formatFileSize } from "@/lib/documents/validation";
export function DocumentAttachmentCard({
  document,
  onExclude,
  disabled = false,
  allowDownload = true,
}: {
  document: Attachment;
  onExclude?: (() => void) | undefined;
  disabled?: boolean;
  allowDownload?: boolean;
}) {
  const status = documentStatus(document);
  const Icon =
    status.key === "ready" ? CheckCircle2 : status.key === "unsuccessful" ? ShieldAlert : Clock3;
  return (
    <article className="attachment-card" aria-label={document.file_name}>
      <FileText className="mt-1 size-7 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <h3 className="attachment-name">{document.file_name}</h3>
          <p className="text-sm text-muted-foreground">
            PDF · {formatFileSize(Number(document.byte_size))}
          </p>
        </div>
        <p className={`document-status status-${status.key}`}>
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          {status.label}
        </p>
        <p className="text-sm text-muted-foreground">{status.help}</p>
        {status.key === "unsuccessful" && onExclude && (
          <p className="text-sm">
            Exclude this attachment and add another PDF, or contact the Diocese for assistance.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
          {allowDownload &&
            document.state === "available" &&
            document.clean &&
            !document.excluded && (
              <a
                className="text-sm font-medium text-primary underline underline-offset-4"
                href={`/api/documents/${document.id}/download`}
              >
                Download PDF
              </a>
            )}
          {onExclude && !document.excluded && document.state !== "pending" && (
            <Button variant="ghost" size="sm" disabled={disabled} onClick={onExclude}>
              Exclude attachment
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
