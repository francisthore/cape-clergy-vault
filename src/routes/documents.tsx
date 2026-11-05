import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export const Route = createFileRoute("/documents")({ component: DocumentsPage });
type DocumentRow = { id: string; file_name: string; byte_size: string; state: string };
function DocumentsPage() {
  const [submission, setSubmission] = useState("");
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const upload = useRef<XMLHttpRequest | null>(null);
  const intent = useRef<string | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      upload.current?.abort();
    },
    [],
  );
  async function refresh() {
    const current = ++generation.current;
    setDocuments([]);
    setLoaded(false);
    try {
      const response = await fetch(
        `/api/documents?submissionId=${encodeURIComponent(submission)}`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) throw new Error(data.message);
      setDocuments(data.documents);
      setLoaded(true);
    } catch (error) {
      if (current === generation.current)
        setMessage(error instanceof Error ? error.message : "Documents are unavailable.");
    }
  }
  // Recheck authorization while open; clear private metadata before each request.
  useEffect(() => {
    if (!loaded) return;
    const recheck = () => {
      void refresh();
    };
    const timer = window.setInterval(recheck, 30_000);
    window.addEventListener("focus", recheck);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", recheck);
    };
    // refresh uses the current submission; loaded/submission changes rebuild this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, submission]);
  function send() {
    if (!file || upload.current) return;
    if (!/\.pdf$/i.test(file.name) || file.size === 0 || file.size > 20 * 1024 * 1024) {
      setMessage("Choose a nonempty PDF of at most 20 MiB.");
      return;
    }
    intent.current ??= crypto.randomUUID();
    const xhr = new XMLHttpRequest();
    upload.current = xhr;
    xhr.open(
      "POST",
      `/api/documents?submissionId=${encodeURIComponent(submission)}&requestId=${intent.current}`,
    );
    xhr.setRequestHeader("Content-Type", "application/pdf");
    xhr.setRequestHeader("X-Document-Name", encodeURIComponent(file.name));
    xhr.timeout = 5 * 60_000;
    setMessage("");
    setProgress(0);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    const done = () => {
      upload.current = null;
      setProgress(null);
    };
    xhr.onload = () => {
      done();
      let feedback = "Upload unavailable. Refresh the list before retrying.";
      try {
        feedback = (JSON.parse(xhr.responseText) as { message: string }).message;
      } catch {
        /* Safe fallback. */
      }
      setMessage(feedback);
      if (xhr.status === 201) {
        intent.current = null;
        setFile(null);
      }
      void refresh();
    };
    xhr.onerror = xhr.ontimeout = () => {
      done();
      setMessage("Connection interrupted. Refresh the document list before retrying.");
    };
    xhr.onabort = () => {
      done();
      setMessage("Upload cancelled. Refresh the list to check its state.");
    };
    xhr.send(file);
  }
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <h1 className="text-3xl font-semibold text-primary">Submission documents</h1>
      <p>
        This Phase 3C test workspace attaches PDFs to an existing submission. Submission creation
        and theological review will follow in a later phase. Your approved account and current
        repository consent are required.
      </p>
      <form
        className="space-y-3 rounded-lg border bg-card p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage("");
          void refresh();
        }}
      >
        <label htmlFor="submission-id">Submission ID</label>
        <Input
          id="submission-id"
          required
          value={submission}
          disabled={progress !== null}
          onChange={(event) => {
            generation.current++;
            setSubmission(event.target.value);
            setDocuments([]);
            setLoaded(false);
            intent.current = null;
          }}
          placeholder="Submission UUID supplied by the test operator"
        />
        <Button disabled={progress !== null}>Load documents</Button>
      </form>
      {loaded && (
        <section
          className="space-y-4 rounded-lg border bg-card p-5"
          aria-label="Attached documents"
        >
          <ul className="space-y-3">
            {documents.map((document) => (
              <li key={document.id}>
                <span>
                  {document.file_name} ({Number(document.byte_size).toLocaleString()} bytes) —{" "}
                  {document.state}
                </span>{" "}
                {document.state === "available" && (
                  <a
                    className="text-primary underline"
                    href={`/api/documents/${document.id}/download`}
                  >
                    Download
                  </a>
                )}
                {document.state === "failed" && (
                  <span>Upload unavailable. Ask the operator to reconcile it.</span>
                )}
              </li>
            ))}
          </ul>
          {documents.length === 0 && <p>No attached documents.</p>}
          {documents.length === 100 && <p>Showing the first 100 documents.</p>}
          <label htmlFor="document-file" className="block">
            Attach a PDF (maximum 20 MiB)
          </label>
          <Input
            id="document-file"
            type="file"
            accept=".pdf,application/pdf"
            disabled={progress !== null}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              intent.current = null;
            }}
          />
          <p className="text-sm">
            Uploads require ownership and a submitted document submission. Confidentiality remains a
            property of the submission.
          </p>
          <Button disabled={!file || progress !== null} onClick={send}>
            Upload document
          </Button>
          {progress !== null && (
            <div className="space-y-2">
              <progress aria-label="Upload progress" max={100} value={progress} />{" "}
              <span>{progress}% sent; validation follows.</span>
              <Button variant="outline" onClick={() => upload.current?.abort()}>
                Cancel upload
              </Button>
            </div>
          )}
        </section>
      )}
      {message && <p role="status">{message}</p>}
      <a className="block text-primary underline" href="/account">
        Back to account
      </a>
    </main>
  );
}
