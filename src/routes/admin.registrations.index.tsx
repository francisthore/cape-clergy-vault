import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { registrationRequest, type Registration } from "@/lib/approvals/types";
export const Route = createFileRoute("/admin/registrations/")({ component: Registrations });
function Registrations() {
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: Registration[]; total: number }>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined);
    setError("");
    void registrationRequest<{ rows: Registration[]; total: number }>(
      `?${new URLSearchParams({ status, search, page: String(page) })}`,
      undefined,
      controller.signal,
    )
      .then(setData)
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [status, search, page, refresh]);
  useEffect(() => {
    const update = () => setRefresh((r) => r + 1);
    const timer = setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <a className="text-primary underline" href="/account">
        Your account
      </a>
      <div>
        <h1 className="text-4xl font-semibold text-primary">Clergy registrations</h1>
        <p className="mt-2 text-muted-foreground">
          Review registrations and manage clergy account access.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(draft);
          setPage(1);
          setRefresh((r) => r + 1);
        }}
      >
        <label className="grow">
          Search name, parish or email
          <Input value={draft} maxLength={120} onChange={(e) => setDraft(e.target.value)} />
        </label>
        <label>
          Status
          <select
            className="block h-10 rounded-md border bg-background px-3"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            {["pending", "approved", "rejected", "suspended", "all"].map((s) => (
              <option key={s} value={s}>
                {s[0]!.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <Button>Search</Button>
      </form>
      {error ? (
        <p role="alert">
          {error}{" "}
          <a className="underline" href="/auth?view=login">
            Sign in
          </a>
        </p>
      ) : !data ? (
        <p role="status">Loading registrations…</p>
      ) : (
        <>
          <p role="status">
            {data.total} registration{data.total === 1 ? "" : "s"}
          </p>
          {data.rows.length === 0 ? (
            <p className="rounded-lg border bg-card p-6">No registrations match these filters.</p>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {data.rows.map((r) => (
                <li className="space-y-2 rounded-lg border bg-card p-5" key={r.user_id}>
                  <Link
                    className="text-xl font-semibold text-primary underline"
                    to="/admin/registrations/$userId"
                    params={{ userId: r.user_id }}
                  >
                    {r.title} {r.full_name}
                  </Link>
                  <p>{r.parish}</p>
                  <p className="break-all">{r.email}</p>
                  <p>
                    <span className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold">
                      {r.approval_status}
                    </span>{" "}
                    · Email {r.email_verified ? "verified" : "unverified"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Registered {new Date(r.created_at).toLocaleDateString("en-ZA")}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <nav aria-label="Registration pages" className="flex items-center gap-4">
            <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span>
              Page {page} of {Math.max(1, Math.ceil(data.total / 20))}
            </span>
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
