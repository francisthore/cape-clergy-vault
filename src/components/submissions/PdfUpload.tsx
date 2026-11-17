import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatFileSize } from "@/lib/documents/validation";
export function PdfUpload({
  selected,
  guidance,
  onSelect,
  onUpload,
  onCancel,
  error,
  checking,
  progress,
  disabled,
  editing,
  hasAttachments,
}: {
  selected: File | null;
  guidance?: string | undefined;
  onSelect: (file: File | undefined) => void;
  onUpload: () => void;
  onCancel: () => void;
  error: string;
  checking: boolean;
  progress: number | null;
  disabled: boolean;
  editing: boolean;
  hasAttachments: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
  const previousProgress = useRef<number | null>(null);
  useEffect(() => {
    if (previousProgress.current !== null && progress === null && !selected)
      choose.current?.focus();
    previousProgress.current = progress;
  }, [progress, selected]);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  return (
    <div className="space-y-4">
      {hasAttachments && !expanded && !selected && !error && progress === null ? (
        <Button
          ref={choose}
          variant="outline"
          disabled={disabled}
          onClick={() => {
            setExpanded(true);
            input.current?.click();
          }}
        >
          Add another PDF
        </Button>
      ) : (
        <div
          className={`upload-area ${dragging ? "border-primary bg-accent" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!disabled) {
              if (event.dataTransfer.files.length !== 1) onSelect(undefined);
              else onSelect(event.dataTransfer.files[0]);
            }
          }}
        >
          <Upload className="mx-auto size-6 text-primary" aria-hidden="true" />
          <div>
            <p className="font-medium">Attach a PDF</p>
            <p id="pdf-limit" className="text-sm text-muted-foreground">
              {guidance ?? "Choose or drop one PDF. Maximum 20 MiB."}
            </p>
          </div>
          <Button
            ref={choose}
            variant="outline"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            Choose PDF
          </Button>
        </div>
      )}
      {hasAttachments && !expanded && !selected && !error && progress === null && (
        <p id="pdf-limit" className="text-sm text-muted-foreground">
          {guidance ?? "Choose or drop one PDF. Maximum 20 MiB."}
        </p>
      )}
      <input
        ref={input}
        id="pdf"
        type="file"
        className="sr-only"
        tabIndex={-1}
        accept=".pdf,application/pdf"
        aria-label="Attach a PDF (maximum 20 MiB)"
        aria-describedby="pdf-limit pdf-error"
        aria-invalid={!!error}
        disabled={disabled}
        onChange={(event) => {
          onSelect(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <p id="pdf-error" role="alert" className="text-sm text-destructive">
        {error}
      </p>
      {checking && (
        <p role="status" className="text-sm">
          Checking the selected PDF format…
        </p>
      )}
      {selected && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-4">
          <p className="min-w-0 break-words text-sm">
            <strong>{selected.name}</strong>
            <br />
            {formatFileSize(selected.size)} · Selected for upload
          </p>
          <Button disabled={disabled || editing || !!error} onClick={onUpload}>
            Upload PDF
          </Button>
        </div>
      )}
      {editing && (
        <p className="text-sm text-muted-foreground">
          Save your changes or close the editor before uploading or excluding attachments.
        </p>
      )}
      {progress !== null && (
        <div className="space-y-2" role="status">
          <label htmlFor="upload-progress" className="text-sm">
            {progress === 100
              ? "Upload sent. Waiting for the server to save your PDF…"
              : `Uploading PDF · ${progress}%`}
          </label>
          <progress
            id="upload-progress"
            aria-label="Upload progress"
            className="block h-2 w-full accent-primary"
            max={100}
            value={progress}
          />
          <p className="text-sm text-muted-foreground">
            Security verification begins after the upload is saved.
          </p>
          <Button variant="outline" onClick={onCancel}>
            Cancel upload
          </Button>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        PDFs remain private and unavailable until the required security checks pass.
      </p>
    </div>
  );
}
