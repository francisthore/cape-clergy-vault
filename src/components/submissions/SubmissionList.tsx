import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { categories, type SubmissionRow } from "@/lib/submissions/validation";
import { submissionRequest } from "@/lib/submissions/client";
export function SubmissionList({ repository = false }: { repository?: boolean }) {
  const [rows, setRows] = useState<SubmissionRow[] | null>(null),
    [message, setMessage] = useState(""),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1);
  const [query, setQuery] = useState({ search: "", category: "", keyword: "", status: "" });
  const [filter, setFilter] = useState(query);
  useEffect(() => {
    let active = true;
    const load = () => {
      setRows(null);
      setMessage("");
      void submissionRequest(
        `/api/${repository ? "repository" : "submissions"}?${new URLSearchParams({ ...filter, page: String(page) })}`,
      )
        .then((v) => {
          if (active) {
            setRows(v.items);
            setTotal(v.total);
          }
        })
        .catch((e) => {
          if (active) setMessage(e.message);
        });
    };
    load();
    const timer = window.setInterval(load, 30000);
    window.addEventListener("focus", load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [filter, page, repository]);
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-12">
      <h1 className="text-3xl text-primary">
        {repository ? "Clergy repository" : "My submissions"}
      </h1>
      <nav className="flex flex-wrap gap-5">
        <a className="text-primary underline" href="/account">
          Account
        </a>
        <a className="text-primary underline" href={repository ? "/submissions" : "/repository"}>
          {repository ? "My submissions" : "Browse repository"}
        </a>
        {!repository && (
          <a href="/submissions/new" className="text-primary underline">
            Create a draft
          </a>
        )}
      </nav>
      <p>
        {repository
          ? "Discover accepted, non-confidential resources. Current repository consent and account approval are required."
          : "Save your work as a draft, attach PDFs, then submit when ready."}
      </p>
      <form
        className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilter({ ...query });
        }}
      >
        <label>
          Search
          <Input
            value={query.search}
            maxLength={120}
            onChange={(e) => setQuery({ ...query, search: e.target.value })}
          />
        </label>
        <label>
          Category
          <select
            className="block w-full rounded border bg-background p-2"
            value={query.category}
            onChange={(e) => setQuery({ ...query, category: e.target.value })}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Exact keyword
          <Input
            maxLength={60}
            value={query.keyword}
            onChange={(e) => setQuery({ ...query, keyword: e.target.value })}
          />
        </label>
        {!repository && (
          <label>
            Status
            <select
              className="block w-full rounded border bg-background p-2"
              value={query.status}
              onChange={(e) => setQuery({ ...query, status: e.target.value })}
            >
              <option value="">All statuses</option>
              {["draft", "submitted", "under_review", "accepted", "returned"].map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button>Apply filters</Button>
      </form>
      {message ? (
        <p role="alert">{message}</p>
      ) : rows === null ? (
        <p role="status">Loading…</p>
      ) : (
        <>
          <p>{total} matching items</p>
          {rows.length === 0 ? (
            <p>
              No items match.{" "}
              {repository
                ? "Accepted resources will appear here when available."
                : "Create a draft to begin, or adjust your filters."}
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {rows.map((s) => (
                <li key={s.id} className="space-y-2 rounded-lg border bg-card p-5">
                  <h2 className="text-xl">
                    <a
                      className="text-primary underline"
                      href={`/${repository ? "repository" : "submissions"}/${s.id}`}
                    >
                      {s.title}
                    </a>
                  </h2>
                  <p>
                    {s.kind} · {s.category}
                  </p>
                  <p className="capitalize">
                    {s.status.replace("_", " ")} ·{" "}
                    {s.confidential ? "Confidential" : "Non-confidential"}
                  </p>
                  <p>
                    {s.submitted_at
                      ? `Submitted ${new Date(s.submitted_at).toLocaleDateString()}`
                      : `Created ${new Date(s.created_at).toLocaleDateString()}`}{" "}
                    · {s.document_count} attachments
                  </p>
                  <a
                    className="text-primary underline"
                    href={`/${repository ? "repository" : "submissions"}/${s.id}`}
                  >
                    {s.status === "draft" && !repository ? "Continue draft" : "View details"}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-4">
            <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              variant="outline"
              disabled={page * 20 >= total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
