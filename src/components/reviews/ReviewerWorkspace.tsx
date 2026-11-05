import { reviewRequest } from "@/lib/reviews/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
type Row = {
  id: string;
  title: string;
  kind: string;
  category: string;
  confidential: boolean;
  status: string;
  revision: number;
  assigned_at: string;
  submitted_at: string | null;
};
type Detail = {
  submission: Row & { abstract: string; keywords: string[]; version: number };
  assignment: { assigned_at: string };
  author: { name: string; title: string; parish: string };
  documents: { id: string; file_name: string; byte_size: string }[];
  history: {
    id: string;
    outcome: string;
    notes: string;
    author_feedback: string;
    revision: number;
    created_at: string;
  }[];
};
export function ReviewerWorkspace() {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<{ items: Row[]; total: number } | null>(null),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      setData(null);
      setMessage("");
      try {
        const result = await reviewRequest(
          undefined,
          `?${new URLSearchParams({ search, status, page: String(page) })}`,
        );
        if (active) setData(result);
      } catch (e) {
        if (active) setMessage(e instanceof Error ? e.message : "Unavailable.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30000),
      focus = () => void load();
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [search, status, page]);
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-12">
      <a className="text-primary underline" href="/account">
        My account
      </a>
      <h1 className="text-4xl font-semibold text-primary">Theological review</h1>
      <p>
        Review your assigned resources. Access applies to the stated revision and is checked while
        you work.
      </p>
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(String(new FormData(e.currentTarget).get("search") ?? ""));
          setPage(1);
        }}
      >
        <div className="min-w-48 flex-1">
          <label htmlFor="review-search">Search assigned resources</label>
          <Input id="review-search" name="search" maxLength={200} />
        </div>
        <div>
          <label className="block" htmlFor="review-status">
            Review status
          </label>
          <select
            id="review-status"
            className="h-10 rounded border bg-background px-3"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All current assignments</option>
            <option value="submitted">Awaiting review</option>
            <option value="under_review">In progress</option>
            <option value="accepted">Accepted</option>
            <option value="returned">Returned</option>
          </select>
        </div>
        <Button>Search</Button>
      </form>
      {!data ? (
        <p role="status">{message || "Loading assignments…"}</p>
      ) : (
        <>
          <p>{data.total} authorized assignments</p>
          {!data.items.length && (
            <p>
              No assignments match these filters. A trusted operator must assign each revision
              explicitly.
            </p>
          )}
          <ul className="space-y-4">
            {data.items.map((s) => (
              <li key={s.id} className="space-y-2 rounded-lg border bg-card p-5">
                <a
                  className="font-serif text-xl text-primary underline"
                  href={`/reviewer/submissions/${s.id}`}
                >
                  {s.title}
                </a>
                <p className="capitalize">
                  {s.status.replaceAll("_", " ")} · {s.kind} · {s.category} · Revision {s.revision}
                </p>
                <p>
                  {s.confidential ? "Confidential" : "Non-confidential"} · Assigned{" "}
                  {new Date(s.assigned_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
          <nav aria-label="Assignment pages" className="flex items-center gap-4">
            <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              variant="outline"
              disabled={page * 20 >= data.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </nav>
        </>
      )}
    </main>
  );
}
export function ReviewerDetail({ id }: { id: string }) {
  const [data, setData] = useState<Detail | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false),
    [feedback, setFeedback] = useState(""),
    [notes, setNotes] = useState(""),
    [confirm, setConfirm] = useState<"accepted" | "returned" | null>(null);
  const intent = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setData(null);
    setMessage("");
    try {
      const fresh = await reviewRequest(undefined, `?id=${encodeURIComponent(id)}`);
      if (current !== generation.current) return;
      setData(fresh);
      setStale(false);
    } catch (e) {
      if (current === generation.current)
        setMessage(e instanceof Error ? e.message : "Unavailable.");
    }
  }, [id]);
  useEffect(() => {
    void load();
    return () => {
      // Invalidate asynchronous loads; this ref is a counter, not a DOM node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    let active = true;
    const probe = async () => {
      try {
        const fresh: Detail = await reviewRequest(undefined, `?id=${encodeURIComponent(id)}`);
        if (active && data && fresh.submission.version !== data.submission.version) {
          setStale(true);
          setConfirm(null);
          setMessage("This submission changed. Refresh before making another decision.");
        }
      } catch (e) {
        if (active) {
          setData(null);
          setConfirm(null);
          setMessage(e instanceof Error ? e.message : "Unavailable.");
        }
      }
    };
    const timer = setInterval(() => void probe(), 30000),
      focus = () => void probe();
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [data, id]);
  async function decide(outcome: "under_review" | "accepted" | "returned") {
    if (!data || busy || stale) return;
    setBusy(true);
    setMessage("");
    const value = {
        action: "decide",
        id,
        version: data.submission.version,
        outcome,
        feedback,
        privateNotes: notes,
      },
      fingerprint = JSON.stringify(value);
    if (intent.current?.fingerprint !== fingerprint)
      intent.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      await reviewRequest({ ...value, requestId: intent.current.requestId });
      setConfirm(null);
      setNotes("");
      setFeedback("");
      intent.current = null;
      await load();
      setMessage("Review recorded.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unavailable.");
      if ((e as { status?: number }).status === 409) {
        setStale(true);
        setConfirm(null);
      }
    } finally {
      setBusy(false);
    }
  }
  const s = data?.submission;
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <a className="text-primary underline" href="/reviewer">
        Back to reviewer workspace
      </a>
      {!s || !data ? (
        <p role="status">{message || "Loading review…"}</p>
      ) : (
        <>
          <h1 className="text-3xl text-primary">{s.title}</h1>
          <p className="capitalize">
            {s.category} · {s.kind} · Revision {s.revision} · {s.status.replaceAll("_", " ")}
          </p>
          <p>
            {s.confidential ? "Confidential" : "Non-confidential"} · Assigned{" "}
            {new Date(data.assignment.assigned_at).toLocaleString()}
          </p>
          <p>
            Author: {data.author.title} {data.author.name} · {data.author.parish}
          </p>
          <p className="whitespace-pre-wrap">{s.abstract}</p>
          <p>Keywords: {s.keywords.join(", ") || "None"}</p>
          <section
            className="space-y-3 rounded-lg border bg-card p-5"
            aria-label="Review documents"
          >
            <h2 className="text-xl">Documents</h2>
            {!data.documents.length && <p>No document attachments.</p>}
            <ul>
              {data.documents.map((d) => (
                <li key={d.id}>
                  <a className="text-primary underline" href={`/api/documents/${d.id}/download`}>
                    Download {d.file_name}
                  </a>{" "}
                  · {Number(d.byte_size).toLocaleString()} bytes
                </li>
              ))}
            </ul>
            {data.documents.length === 100 && (
              <p>Showing the first 100 attachments. Contact the operator for older records.</p>
            )}
          </section>
          {["submitted", "under_review"].includes(s.status) && (
            <section
              className="space-y-4 rounded-lg border bg-card p-5"
              aria-label="Review decision"
            >
              <h2 className="text-xl">Review decision</h2>
              <label className="block" htmlFor="feedback">
                Feedback for the author
              </label>
              <Textarea
                id="feedback"
                rows={4}
                maxLength={10000}
                value={feedback}
                disabled={busy || stale}
                onChange={(e) => setFeedback(e.target.value)}
              />
              <p className="text-sm">
                This text is visible to the author. Returning work requires at least 20 meaningful
                characters explaining the amendments.
              </p>
              <label className="block" htmlFor="private-notes">
                Private reviewer notes
              </label>
              <Textarea
                id="private-notes"
                rows={4}
                maxLength={10000}
                value={notes}
                disabled={busy || stale}
                onChange={(e) => setNotes(e.target.value)}
              />
              <p className="text-sm">
                Visible to reviewers currently assigned to this revision. Acceptance requires a
                private rationale of at least 20 meaningful characters. Notes are saved with the
                review action.
              </p>
              <div className="flex flex-wrap gap-3">
                {s.status === "submitted" ? (
                  <Button disabled={busy || stale} onClick={() => void decide("under_review")}>
                    Start review
                  </Button>
                ) : (
                  <>
                    <Button disabled={busy || stale} onClick={() => setConfirm("accepted")}>
                      Accept submission
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy || stale}
                      onClick={() => setConfirm("returned")}
                    >
                      Return for amendment
                    </Button>
                  </>
                )}
              </div>
            </section>
          )}
          <Button variant="outline" disabled={busy} onClick={() => void load()}>
            Refresh review
          </Button>
          <section className="space-y-4">
            <h2 className="text-xl">Review history for this revision</h2>
            {!data.history.length && <p>No decisions yet.</p>}
            {data.history.map((h) => (
              <article className="space-y-2 rounded border p-4" key={h.id}>
                <p className="capitalize">
                  {h.outcome.replaceAll("_", " ")} · Revision {h.revision} ·{" "}
                  {new Date(h.created_at).toLocaleString()}
                </p>
                <h3 className="font-semibold">Feedback for the author</h3>
                <p className="whitespace-pre-wrap">{h.author_feedback || "None"}</p>
                <h3 className="font-semibold">Private reviewer notes</h3>
                <p className="whitespace-pre-wrap">{h.notes || "None"}</p>
              </article>
            ))}
          </section>
          <AlertDialog
            open={confirm !== null}
            onOpenChange={(open) => {
              if (!open && !busy) setConfirm(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirm === "accepted"
                    ? "Accept this revision?"
                    : "Return this revision for amendment?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirm === "accepted"
                    ? s.confidential
                      ? "The resource will remain confidential."
                      : "The resource will become discoverable in the clergy repository."
                    : "The author will receive the feedback entered above and can prepare an amended revision."}{" "}
                  This decision and its notes are retained in immutable history.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Keep reviewing</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy || stale}
                  onClick={(e) => {
                    e.preventDefault();
                    if (confirm) void decide(confirm);
                  }}
                >
                  {busy ? "Recording…" : "Confirm decision"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {message && <p role="status">{message}</p>}
        </>
      )}
    </main>
  );
}
