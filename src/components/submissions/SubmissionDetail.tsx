import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SubmissionRow } from "@/lib/submissions/validation";
import { submissionRequest } from "@/lib/submissions/client";
import { SubmissionForm } from "./SubmissionForm";
type Detail = {
  submission: SubmissionRow;
  documents: {
    id: string;
    file_name: string;
    byte_size: string;
    state: string;
    excluded: boolean;
  }[];
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
    [confirm, setConfirm] = useState(false),
    [progress, setProgress] = useState<number | null>(null);
  const xhr = useRef<XMLHttpRequest | null>(null),
    intent = useRef<string | null>(null),
    generation = useRef(0);
  const load = useCallback(async () => {
    const g = ++generation.current;
    setData(null);
    try {
      const v = await submissionRequest(
        `/api/${repository ? "repository" : "submissions"}?id=${encodeURIComponent(id)}`,
      );
      if (g === generation.current) setData(v);
    } catch (e) {
      if (g === generation.current) setMessage(e instanceof Error ? e.message : "Unavailable");
    }
  }, [id, repository]);
  useEffect(() => {
    void load();
    return () => {
      // This is an async generation counter, intentionally invalidated at cleanup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      xhr.current?.abort();
    };
  }, [load]);
  // Reload authorization while open. Explicit editing is kept in a separately mounted form.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!editing && progress === null) {
        void load();
        return;
      }
      // Keep unsaved input while still rechecking live permissions during editing/upload.
      void submissionRequest(
        `/api/${repository ? "repository" : "submissions"}?id=${encodeURIComponent(id)}`,
      ).catch((error) => {
        if (!active) return;
        generation.current++;
        xhr.current?.abort();
        setData(null);
        setEditing(false);
        setMessage(error.message);
      });
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load, editing, progress, id, repository]);
  async function action(action: "submit" | "amend" | "exclude", target = id) {
    if (!data || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const v = await submissionRequest("/api/submissions", {
        action,
        id: target,
        version: data.submission.version,
      });
      setMessage(v.message);
      setConfirm(false);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unavailable");
    } finally {
      setBusy(false);
    }
  }
  function upload(file: File) {
    if (xhr.current || !data) return;
    if (!/\.pdf$/i.test(file.name) || !file.size || file.size > 20 * 1024 * 1024) {
      setMessage("Choose a nonempty PDF up to 20 MiB.");
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
      if (x.status === 201) intent.current = null;
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
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <a className="text-primary underline" href={repository ? "/repository" : "/submissions"}>
        Back to {repository ? "repository" : "my submissions"}
      </a>
      {!s ? (
        <p role="status">{message || "Loading…"}</p>
      ) : (
        <>
          <h1 className="text-3xl text-primary">{s.title}</h1>
          <p className="capitalize">
            {s.status.replace("_", " ")} · {s.kind} · {s.category} · Revision {s.revision}
          </p>
          <p>
            {s.confidential ? "Confidential" : "Non-confidential"} ·{" "}
            {s.submitted_at
              ? `Submitted ${new Date(s.submitted_at).toLocaleString()}`
              : "Not yet submitted"}
          </p>
          <p className="whitespace-pre-wrap">{s.abstract}</p>
          <p>Keywords: {s.keywords.join(", ") || "None"}</p>
          {editable && (
            <>
              <Button
                variant="outline"
                disabled={busy || progress !== null}
                onClick={() => {
                  setEditing(!editing);
                  setConfirm(false);
                }}
              >
                {editing ? "Close editor" : "Edit draft"}
              </Button>
              {editing && (
                <SubmissionForm
                  key={`${s.id}:${s.version}`}
                  submission={s}
                  onSaved={() => {
                    setEditing(false);
                    setMessage("Draft saved.");
                    void load();
                  }}
                />
              )}
            </>
          )}
          <section
            className="space-y-4 rounded-lg border bg-card p-5"
            aria-label="Attached documents"
          >
            <h2 className="text-xl">Documents</h2>
            {data.documents.length === 0 && <p>No attached documents.</p>}
            <ul className="space-y-3">
              {data.documents.map((d) => (
                <li key={d.id}>
                  {d.file_name} · {Number(d.byte_size).toLocaleString()} bytes ·{" "}
                  {d.excluded ? "Excluded from this revision" : d.state}
                  {d.state === "available" && !d.excluded && (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        className="text-primary underline"
                        href={`/api/documents/${d.id}/download`}
                      >
                        Download PDF
                      </a>
                    </>
                  )}
                  {editable && !d.excluded && d.state !== "pending" && (
                    <Button
                      className="ml-3"
                      variant="outline"
                      disabled={busy || progress !== null || editing}
                      onClick={() => void action("exclude", d.id)}
                    >
                      Exclude attachment
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {data.documents.length === 100 && (
              <p>Showing the first 100 attachments. Contact the operator for older records.</p>
            )}
            {editable && s.kind === "document" && (
              <>
                <label className="block" htmlFor="pdf">
                  Attach a PDF (maximum 20 MiB)
                </label>
                <Input
                  id="pdf"
                  type="file"
                  accept=".pdf,application/pdf"
                  disabled={busy || progress !== null || editing}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    intent.current = null;
                    if (f) upload(f);
                    e.target.value = "";
                  }}
                />
                {progress !== null && (
                  <>
                    <progress aria-label="Upload progress" max={100} value={progress} />
                    <p>{progress}% sent; validation follows.</p>
                    <Button variant="outline" onClick={() => xhr.current?.abort()}>
                      Cancel upload
                    </Button>
                  </>
                )}
                <p>Local testing with disposable PDFs only. Files have not been malware scanned.</p>
              </>
            )}
          </section>
          {editable && !editing && (
            <>
              <Button disabled={busy || progress !== null} onClick={() => setConfirm(true)}>
                Submit for review
              </Button>
              {confirm && (
                <div
                  role="group"
                  aria-label="Confirm final submission"
                  className="space-y-3 rounded border p-4"
                >
                  <p>
                    Submit this saved revision? Metadata and attachments will be locked for review.
                  </p>
                  <Button
                    disabled={busy || progress !== null}
                    onClick={() => void action("submit")}
                  >
                    Confirm submission
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>
                    Keep draft
                  </Button>
                </div>
              )}
            </>
          )}
          {!repository && s.status === "returned" && (
            <Button disabled={busy} onClick={() => void action("amend")}>
              Start an amended draft
            </Button>
          )}
          {!repository && (
            <section>
              <h2 className="text-xl">Lifecycle history</h2>
              <ul>
                {data.history.map((h) => (
                  <li key={`${h.version}-${h.event}`}>
                    {h.event.replaceAll("_", " ")} · Revision {h.revision} ·{" "}
                    {new Date(h.created_at).toLocaleString()}
                  </li>
                ))}
              </ul>
              <h2 className="mt-6 text-xl">Review outcomes and feedback</h2>
              {data.feedback.length === 0 && <p>No review outcomes yet.</p>}
              <ul className="space-y-4">
                {data.feedback.map((f) => (
                  <li key={f.id} className="rounded border bg-card p-4">
                    <p className="capitalize">
                      {f.outcome.replaceAll("_", " ")} · Revision {f.revision} ·{" "}
                      {new Date(f.created_at).toLocaleString()}
                    </p>
                    <p className="whitespace-pre-wrap">
                      {f.author_feedback || "No author-facing feedback for this action."}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {message && <p role="status">{message}</p>}
        </>
      )}
    </main>
  );
}
