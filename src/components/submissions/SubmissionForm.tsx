import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { categories, type SubmissionRow } from "@/lib/submissions/validation";
import { submissionRequest } from "@/lib/submissions/client";
export function SubmissionForm({
  submission,
  onSaved,
}: {
  submission?: SubmissionRow;
  onSaved: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="space-y-4 rounded-lg border bg-card p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setMessage("");
        try {
          const v = await submissionRequest("/api/submissions", {
            action: "save",
            ...(submission ? { id: submission.id } : {}),
            version: submission?.version ?? 0,
            kind: submission?.kind ?? f.get("kind"),
            title: f.get("title"),
            category: f.get("category"),
            abstract: f.get("abstract"),
            keywords: String(f.get("keywords"))
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            confidential: f.get("confidential") === "on",
          });
          onSaved(v.id);
        } catch (e) {
          setMessage(e instanceof Error ? e.message : "Save unavailable");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block" htmlFor="kind">
        Submission type
        <select
          id="kind"
          name="kind"
          defaultValue={submission?.kind ?? "document"}
          disabled={busy || !!submission}
          className="block w-full rounded border bg-background p-2"
        >
          <option value="document">Document (PDF)</option>
          <option value="idea">Idea / Proposal (text)</option>
        </select>
      </label>
      <label className="block" htmlFor="title">
        Title
        <Input
          id="title"
          name="title"
          required
          maxLength={200}
          defaultValue={submission?.title}
          disabled={busy}
        />
      </label>
      <label className="block" htmlFor="category">
        Category
        <select
          id="category"
          name="category"
          defaultValue={submission?.category ?? "General"}
          disabled={busy}
          className="block w-full rounded border bg-background p-2"
        >
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="block" htmlFor="abstract">
        Abstract or description
        <textarea
          id="abstract"
          name="abstract"
          rows={8}
          maxLength={20000}
          defaultValue={submission?.abstract}
          disabled={busy}
          className="block w-full rounded border bg-background p-2"
          aria-describedby="description-help"
        />
      </label>
      <p id="description-help">
        You can save an unfinished draft. Final submission requires at least 20 characters of
        description; documents also require an available PDF.
      </p>
      <label className="block" htmlFor="keywords">
        Keywords (comma separated, up to 20)
        <Input
          id="keywords"
          name="keywords"
          defaultValue={submission?.keywords.join(", ")}
          disabled={busy}
        />
      </label>
      <label className="flex gap-3">
        <input
          name="confidential"
          type="checkbox"
          defaultChecked={submission?.confidential}
          disabled={busy}
        />
        Confidential — restrict this item to you and authorized reviewers
      </label>
      <Button disabled={busy}>{busy ? "Saving…" : "Save draft"}</Button>
      {message && <p role="alert">{message}</p>}
    </form>
  );
}
