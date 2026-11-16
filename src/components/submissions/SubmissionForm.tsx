import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { categories, type SubmissionRow } from "@/lib/submissions/validation";
import { submissionRequest } from "@/lib/submissions/client";
export function SubmissionForm({
  submission,
  onSaved,
  disabled = false,
}: {
  submission?: SubmissionRow;
  disabled?: boolean;
  onSaved: (id: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || disabled) return;
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
          await onSaved(v.id);
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
          disabled={busy || disabled || !!submission}
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
          disabled={busy || disabled}
        />
      </label>
      <label className="block" htmlFor="category">
        Category
        <select
          id="category"
          name="category"
          defaultValue={submission?.category ?? "General"}
          disabled={busy || disabled}
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
          rows={6}
          maxLength={20000}
          defaultValue={submission?.abstract}
          disabled={busy || disabled}
          className="block w-full rounded border bg-background p-2"
          aria-describedby="description-help"
        />
      </label>
      <p id="description-help" className="text-sm text-muted-foreground">
        You can save unfinished work and return later. Sending to TEFT requires at least 20
        characters of description; documents also require an available PDF.
      </p>
      <label className="block" htmlFor="keywords">
        Keywords (comma separated, up to 20)
        <Input
          id="keywords"
          name="keywords"
          defaultValue={submission?.keywords.join(", ")}
          disabled={busy || disabled}
        />
      </label>
      <label className="flex gap-3">
        <input
          name="confidential"
          type="checkbox"
          defaultChecked={submission?.confidential}
          disabled={busy || disabled}
        />
        <span>
          Confidential
          <span className="mt-1 block text-sm font-normal text-muted-foreground">
            Restrict this item to you and authorized assigned reviewers. It will stay outside the
            shared repository.
          </span>
        </span>
      </label>
      <Button disabled={busy || disabled}>{busy ? "Saving…" : "Save resource details"}</Button>
      {message && <p role="alert">{message}</p>}
    </form>
  );
}
