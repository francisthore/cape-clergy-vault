import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SubmissionRow } from "@/lib/submissions/validation";
import { submissionRequest } from "@/lib/submissions/client";
import { validatePdfSelection, validatePdfContents } from "@/lib/documents/validation";
import { DocumentAttachmentCard } from "./DocumentAttachmentCard";
import { PdfUpload } from "./PdfUpload";
import { needsVerification, type Attachment } from "@/lib/documents/status";
import { PageHeader, WorkspaceSection, EmptyState } from "@/components/workspace";
import { CheckCircle2, Circle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { submissionStatusLabel, lifecycleLabel } from "@/lib/submissions/wording";
import { SubmissionForm } from "./SubmissionForm";
import {
  screeningGuidance,
  screeningSelectionError,
  type UploadPolicy,
} from "@/lib/documents/upload-policy";
type Detail = {
  uploadPolicy?: UploadPolicy;
  submission: SubmissionRow;
  assignmentStatus?: "assigned" | "unassigned";
  documents: Attachment[];
  feedback: {
    id: string;
    outcome: string;
    author_feedback: string;
    revision: number;
    created_at: string;
  }[];
  history: { event: string; version: number; revision: number; created_at: string }[];
};
export function SubmissionDetail({ id, repository = false }: { id: string; repository?: boolean }) {
  const [data, setData] = useState<Detail | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<"submit" | "amend" | string | null>(null),
    [progress, setProgress] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [editorSnapshot, setEditorSnapshot] = useState<SubmissionRow | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const workspace = useRef<HTMLElement>(null);
  const confirmationTrigger = useRef<HTMLElement | null>(null);
  function openConfirmation(value: string) {
    confirmationTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirm(value);
  }
  const selectionGeneration = useRef(0);
  const [checkingFile, setCheckingFile] = useState(false);
  const selectFile = async (file: File | undefined) => {
    if (xhr.current) return;
    const current = ++selectionGeneration.current;
    const error = file
      ? (validatePdfSelection(file) ??
        (data?.uploadPolicy
          ? screeningSelectionError(file.size, data.uploadPolicy, data.submission.confidential)
          : null))
      : "Choose or drop one PDF at a time.";
    setFileError(error ?? "");
    setSelectedFile(null);
    setCheckingFile(false);
    intent.current = null;
    if (!file || error) return;
    setCheckingFile(true);
    try {
      const contentError = await validatePdfContents(file);
      if (current !== selectionGeneration.current) return;
      setFileError(contentError ?? "");
      setSelectedFile(contentError ? null : file);
    } catch {
      if (current === selectionGeneration.current)
        setFileError("This file could not be read. Please select it again.");
    } finally {
      if (current === selectionGeneration.current) setCheckingFile(false);
    }
  };
  const xhr = useRef<XMLHttpRequest | null>(null),
    intent = useRef<string | null>(null),
    generation = useRef(0);
  const load = useCallback(async () => {
    const g = ++generation.current;
    try {
      const v = await submissionRequest(
        `/api/${repository ? "repository" : "submissions"}?id=${encodeURIComponent(id)}`,
      );
      if (g === generation.current) {
        setData(v);
        setAuthorized(true);
        return true;
      }
    } catch (e) {
      if (g === generation.current) {
        setAuthorized(false);
        if ([401, 403, 404].includes((e as { status?: number }).status ?? 0)) {
          xhr.current?.abort();
          setData(null);
          setEditorSnapshot(null);
        }
        setMessage(e instanceof Error ? e.message : "Unavailable");
      }
    }
    return false;
  }, [id, repository]);
  useEffect(() => {
    setData(null);
    setAuthorized(false);
    setEditorSnapshot(null);
    setSelectedFile(null);
    setCheckingFile(false);
    setConfirm(null);
    setFileError("");
    setMessage("");
    void load();
    return () => {
      // This is an async generation counter, intentionally invalidated at cleanup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      // Invalidate pending local file reads on route change/unmount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      selectionGeneration.current++;
      if (xhr.current) {
        xhr.current.onload =
          xhr.current.onerror =
          xhr.current.ontimeout =
          xhr.current.onabort =
            null;
        xhr.current.abort();
        xhr.current = null;
      }
    };
  }, [load]);
  const editing = editorSnapshot !== null;
  const waitingForScan = data?.documents.some(needsVerification) ?? false;
  const refreshInFlight = useRef(false);
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState === "hidden" || refreshInFlight.current) return;
      refreshInFlight.current = true;
      try {
        await load();
      } finally {
        refreshInFlight.current = false;
      }
    };
    // Only outstanding verification needs periodic polling. Focus always rechecks
    // authorization, including when idle. Hidden tabs perform no polling requests.
    const timer = waitingForScan ? setInterval(() => void refresh(), 10000) : undefined;
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, waitingForScan]);
  async function action(action: "submit" | "amend" | "exclude", target = id) {
    if (!data || busy || !authorized) return;
    setBusy(true);
    setMessage("");
    try {
      const v = await submissionRequest("/api/submissions", {
        action,
        id: target,
        version: data.submission.version,
      });
      setMessage(v.message);
      setConfirm(null);
      await load();
      requestAnimationFrame(() => workspace.current?.focus());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unavailable");
    } finally {
      setBusy(false);
    }
  }
  function upload(file: File) {
    if (xhr.current || !data || !authorized || busy || editing) return;
    const error =
      validatePdfSelection(file) ??
      (data?.uploadPolicy
        ? screeningSelectionError(file.size, data.uploadPolicy, data.submission.confidential)
        : null);
    if (error) {
      setFileError(error);
      return;
    }
    intent.current ??= crypto.randomUUID();
    const x = new XMLHttpRequest();
    xhr.current = x;
    setProgress(0);
    setMessage("");
    x.open("POST", `/api/documents?submissionId=${id}&requestId=${intent.current}`);
    x.setRequestHeader("Content-Type", "application/pdf");
    x.setRequestHeader("X-Document-Name", encodeURIComponent(file.name));
    x.timeout = 300000;
    x.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    const done = () => {
      xhr.current = null;
      setProgress(null);
    };
    x.onload = () => {
      done();
      let m = "Refresh the list to check upload status.";
      try {
        m = JSON.parse(x.responseText).message;
      } catch {
        /* safe fallback */
      }
      if (x.status === 201) {
        intent.current = null;
        setSelectedFile(null);
        m = "Upload complete. Your PDF has been saved.";
      }
      setMessage(m);
      void load();
    };
    x.onerror =
      x.ontimeout =
      x.onabort =
        () => {
          done();
          setMessage("Upload interrupted. Reload the list before retrying.");
          void load();
        };
    x.send(file);
  }
  const s = data?.submission;
  const editable = !repository && s?.status === "draft";
  const included = data?.documents.filter((d) => !d.excluded) ?? [];
  const detailsReady =
    !!s && s.title.trim().length > 0 && s.abstract.replace(/\s+/g, " ").trim().length >= 20;
  const attached = s?.kind === "idea" || included.length > 0;
  const verified =
    s?.kind === "idea" ||
    (included.length > 0 && included.every((d) => d.state === "available" && d.clean));
  const blockedReason = !authorized
    ? "Refresh to confirm your current access before continuing."
    : busy
      ? "Your current action is being saved."
      : editing
        ? "Save your resource details or close the editor before sending."
        : progress !== null
          ? "Wait for your PDF upload to finish."
          : selectedFile || checkingFile
            ? "Upload the selected PDF or clear the selection before sending."
            : !detailsReady
              ? "Save a title and a description of at least 20 characters."
              : !attached
                ? "Attach at least one PDF to this resource."
                : !verified
                  ? "Every included PDF must pass verification. Wait for pending checks, or exclude unsuccessful attachments."
                  : "";
  const confirmTitle =
    confirm === "submit"
      ? "Send this revision to TEFT?"
      : confirm === "amend"
        ? "Start an amended revision?"
        : "Exclude this attachment?";
  return (
    <main
      ref={workspace}
      tabIndex={-1}
      className={`workspace-shell ${repository ? "!max-w-4xl" : ""}`}
    >
      <a className="back-link" href={repository ? "/repository" : "/submissions"}>
        ← Back to {repository ? "repository" : "my submissions"}
      </a>
      {!s || !data ? (
        <p role="status">{message || "Loading submission…"}</p>
      ) : (
        <>
          <PageHeader
            eyebrow={repository ? "Clergy repository" : `My submissions · Revision ${s.revision}`}
            title={s.title}
            description={
              editable
                ? "Prepare your resource, attach your PDFs and send your saved revision to TEFT when it is ready."
                : `${submissionStatusLabel(s.status)} · ${s.category}`
            }
          />
          <div className={repository ? "space-y-6" : "workspace-grid"}>
            <div className="min-w-0 space-y-6">
              <WorkspaceSection
                title="Resource details"
                description={`${submissionStatusLabel(s.status)} · ${s.kind === "idea" ? "Idea / Proposal" : "Document"} · ${s.category}`}
              >
                <p className="text-sm text-muted-foreground">
                  {s.confidential
                    ? "Confidential · You and authorized assigned reviewers"
                    : "Non-confidential · Eligible for the repository after acceptance"}
                </p>
                {editing && editorSnapshot ? (
                  <SubmissionForm
                    key={s.id}
                    submission={editorSnapshot}
                    disabled={!authorized}
                    onSaved={async () => {
                      if (await load()) {
                        setEditorSnapshot(null);
                        setMessage("Submission saved. You can return later.");
                      } else
                        throw Error(
                          "Details saved, but the latest revision could not be loaded. Refresh before editing again.",
                        );
                    }}
                  />
                ) : (
                  <>
                    <p className="whitespace-pre-wrap leading-relaxed">
                      {s.abstract || "Add a description to help TEFT understand your resource."}
                    </p>
                    {s.keywords.length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        Keywords: {s.keywords.join(", ")}
                      </p>
                    )}
                  </>
                )}
                {editable && (
                  <Button
                    variant="outline"
                    disabled={busy || progress !== null || !authorized}
                    onClick={() => {
                      setEditorSnapshot(editing ? null : s);
                      setConfirm(null);
                    }}
                  >
                    {editing ? "Close editor" : "Edit submission"}
                  </Button>
                )}
              </WorkspaceSection>
              <WorkspaceSection
                title="Attached documents"
                description={
                  s.kind === "idea"
                    ? "This text proposal does not require a PDF."
                    : "Attach your PDFs here. Each file must pass a security check before you send your work."
                }
              >
                {!data.documents.length && (
                  <EmptyState title="No PDFs attached yet">
                    {s.kind === "idea"
                      ? "Your proposal is saved in the resource details above."
                      : "Choose a PDF below to add it to this submission."}
                  </EmptyState>
                )}
                <ul className="space-y-3" aria-live="polite" aria-relevant="additions text">
                  {data.documents.map((d) => (
                    <li key={d.id}>
                      <DocumentAttachmentCard
                        document={d}
                        allowDownload={authorized}
                        disabled={busy || progress !== null || editing || !authorized}
                        onExclude={editable ? () => openConfirmation(d.id) : undefined}
                      />
                    </li>
                  ))}
                </ul>
                {data.documents.length === 100 && (
                  <p className="text-sm">
                    Showing the first 100 attachments. Contact the operator for older records.
                  </p>
                )}
                {editable && s.kind === "document" && (
                  <PdfUpload
                    selected={selectedFile}
                    onSelect={(file) => void selectFile(file)}
                    onUpload={() => selectedFile && upload(selectedFile)}
                    guidance={
                      data.uploadPolicy
                        ? screeningGuidance(data.uploadPolicy, data.submission.confidential)
                        : undefined
                    }
                    onCancel={() => xhr.current?.abort()}
                    error={fileError}
                    checking={checkingFile}
                    progress={progress}
                    disabled={busy || progress !== null || !authorized}
                    editing={editing}
                    hasAttachments={included.length > 0}
                  />
                )}
                {selectedFile && progress === null && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      selectionGeneration.current++;
                      setSelectedFile(null);
                      setFileError("");
                      intent.current = null;
                    }}
                  >
                    Clear selection
                  </Button>
                )}
              </WorkspaceSection>
            </div>
            {!repository && (
              <aside className="min-w-0 space-y-6">
                {editable ? (
                  <WorkspaceSection
                    title="Submission readiness"
                    description="A guide to preparing this saved revision."
                  >
                    <ul className="space-y-4 text-sm">
                      {[
                        [detailsReady && !editing, "Resource details saved"],
                        [
                          attached,
                          s.kind === "idea"
                            ? "Text proposal — no PDF required"
                            : "Required document attached",
                        ],
                        [
                          verified,
                          s.kind === "idea"
                            ? "No document verification required"
                            : "Security verification complete",
                        ],
                        [!blockedReason, "Ready to send for review"],
                      ].map(([complete, label]) => {
                        const Icon = complete ? CheckCircle2 : Circle;
                        return (
                          <li key={String(label)} className="flex items-start gap-3">
                            <Icon
                              className={`mt-0.5 size-4 shrink-0 ${complete ? "text-emerald-800" : "text-muted-foreground"}`}
                              aria-hidden="true"
                            />
                            <span>
                              <span className="sr-only">
                                {complete ? "Complete: " : "Incomplete: "}
                              </span>
                              {label}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="space-y-3 border-t pt-5">
                      <h3 className="font-semibold">Sending to TEFT</h3>
                      <p className="text-sm text-muted-foreground">
                        Sending locks this revision for theological review.
                      </p>
                      <Button
                        className="h-auto min-h-11 w-full whitespace-normal"
                        aria-describedby="submission-blocked"
                        disabled={!!blockedReason}
                        onClick={() => openConfirmation("submit")}
                      >
                        {busy ? "Saving…" : "Send to TEFT for review"}
                      </Button>
                      <p
                        id="submission-blocked"
                        className="text-sm text-muted-foreground"
                        role="status"
                      >
                        {blockedReason ||
                          "Your saved revision is ready. TEFT will confirm eligibility when you send it."}
                      </p>
                    </div>
                  </WorkspaceSection>
                ) : (
                  <WorkspaceSection title="Submission status">
                    <p>{submissionStatusLabel(s.status)}</p>
                    {s.status === "submitted" && (
                      <p>
                        {data.assignmentStatus === "assigned"
                          ? "Assigned for review"
                          : data.assignmentStatus === "unassigned"
                            ? "Awaiting reviewer assignment"
                            : "Refresh to check current assignment status."}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {s.submitted_at
                        ? `Submitted ${new Date(s.submitted_at).toLocaleString()}`
                        : "Not yet submitted"}
                    </p>
                    {s.status === "returned" && (
                      <Button
                        disabled={busy || !authorized}
                        onClick={() => openConfirmation("amend")}
                      >
                        Revise and resubmit
                      </Button>
                    )}
                  </WorkspaceSection>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void load()}
                >
                  Refresh attachment list
                </Button>
                <p className="text-sm text-muted-foreground">
                  You can leave this page and return later. Saved details and uploaded PDFs will be
                  kept.
                </p>
              </aside>
            )}
          </div>
          {!repository && (
            <WorkspaceSection
              title="Submission history and feedback"
              description="Your saved revisions, review outcomes and feedback from TEFT."
            >
              <div className="grid gap-8 md:grid-cols-2">
                <div>
                  <h3 className="mb-3 font-semibold">Submission history</h3>
                  <ol className="history-list">
                    {data.history.map((h) => (
                      <li key={`${h.version}-${h.event}`}>
                        <p>
                          {lifecycleLabel(h.event)} · Revision {h.revision}
                        </p>
                        <time className="text-sm text-muted-foreground">
                          {new Date(h.created_at).toLocaleString()}
                        </time>
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <h3 className="mb-3 font-semibold">Review outcomes and feedback</h3>
                  {!data.feedback.length && (
                    <p className="text-sm text-muted-foreground">
                      No review outcomes yet. Feedback will appear here after a review.
                    </p>
                  )}
                  <ul className="space-y-4">
                    {data.feedback.map((f) => (
                      <li key={f.id} className="rounded-lg border p-4">
                        <p className="font-medium">
                          {submissionStatusLabel(f.outcome)} · Revision {f.revision}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(f.created_at).toLocaleString()}
                        </p>
                        <p className="mt-3 whitespace-pre-wrap">
                          {f.author_feedback || "No author-facing feedback for this action."}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </WorkspaceSection>
          )}
          <AlertDialog
            open={confirm !== null}
            onOpenChange={(open) => {
              if (!open && !busy) setConfirm(null);
            }}
          >
            <AlertDialogContent
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                const trigger = confirmationTrigger.current;
                if (trigger?.isConnected && !trigger.matches(":disabled")) trigger.focus();
                else workspace.current?.focus();
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
                <AlertDialogDescription>
                  {confirm === "submit"
                    ? "Send this saved revision to TEFT for theological review? Metadata and attachments will be locked for review."
                    : confirm === "amend"
                      ? "Your previous revision and its feedback will be retained. The amended revision must be sent for review again."
                      : "This PDF will be excluded from the current revision. It is retained privately for history and is not permanently deleted."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Continue later</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy || !authorized || (confirm === "submit" && !!blockedReason)}
                  onClick={(event) => {
                    event.preventDefault();
                    if (confirm)
                      void action(
                        confirm === "submit" ? "submit" : confirm === "amend" ? "amend" : "exclude",
                        confirm === "submit" || confirm === "amend" ? id : confirm,
                      );
                  }}
                >
                  {busy
                    ? "Saving…"
                    : confirm === "submit"
                      ? "Confirm submission"
                      : confirm === "amend"
                        ? "Start revision"
                        : "Confirm exclusion"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
        </>
      )}
    </main>
  );
}
