import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, openFile } from "@/components/submission-utils";
import {
  listReviewers,
  inviteReviewer,
  revokeReviewer,
  getAuditAndAlerts,
} from "@/lib/reviewer.functions";

export const Route = createFileRoute("/_authenticated/review")({
  head: () => ({
    meta: [
      { title: "Dean's review — Theological Repository" },
      { name: "description", content: "Review clergy submissions." },
      { property: "og:title", content: "Dean's review — Theological Repository" },
      { property: "og:description", content: "Review clergy submissions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: u.user!.id,
      _role: "admin",
    });
    if (!isAdmin) throw redirect({ to: "/verify-reviewer" });
  },
  component: Review,
});

function Review() {
  const { data, isLoading } = useQuery({
    queryKey: ["review"],
    queryFn: async () => {
      const [{ data: subs }, { data: profs }] = await Promise.all([
        supabase.from("submissions").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, title, full_name, parish"),
      ]);
      const byId = new Map((profs ?? []).map((p) => [p.id, p]));
      return (subs ?? []).map((s) => ({ ...s, author: byId.get(s.user_id) }));
    },
  });
  const [filter, setFilter] = useState("open");
  if (isLoading)
    return <main className="mx-auto max-w-5xl px-6 py-12 text-muted-foreground">Loading…</main>;
  const items = (data ?? []).filter(
    (s) =>
      filter === "all" ||
      (filter === "open" ? ["submitted", "under_review"].includes(s.status) : s.status === filter),
  );
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-4xl font-semibold text-primary">Dean's review</h1>
      <SecurityPanel />
      <div className="mt-8 flex flex-wrap gap-2">
        {[
          ["open", "Awaiting review"],
          ["accepted", "Accepted"],
          ["returned", "Returned"],
          ["all", "All"],
        ].map(([k, l]) => (
          <Button
            key={k}
            size="sm"
            variant={filter === k ? "default" : "outline"}
            onClick={() => setFilter(k ?? "all")}
          >
            {l}
          </Button>
        ))}
      </div>
      {!items.length && <p className="mt-6 text-sm text-muted-foreground">Nothing here.</p>}
      <ul className="mt-6 space-y-4">
        {items.map((s) => (
          <ReviewItem key={s.id} s={s} />
        ))}
      </ul>
      <ReviewersPanel />
    </main>
  );
}

function SecurityPanel() {
  const fetchAudit = useServerFn(getAuditAndAlerts);
  const { data } = useQuery({
    queryKey: ["audit"],
    queryFn: () => fetchAudit(),
    refetchInterval: 60000,
  });
  const [open, setOpen] = useState(false);
  if (!data) return null;
  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Security alerts</h2>
        <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show"} audit trail
        </Button>
      </div>
      {!data.alerts.length ? (
        <p className="mt-2 text-sm text-muted-foreground">No unusual activity in the last hour.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.alerts.map((a, i) => (
            <li
              key={i}
              className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm"
            >
              <strong>
                {a.kind === "repeated_denials"
                  ? "Repeated denied access"
                  : "Unusual download volume"}
              </strong>{" "}
              — {a.actorEmail ?? a.actorId ?? "unknown"}: {a.count} events,{" "}
              {new Date(a.first).toLocaleTimeString()}–{new Date(a.last).toLocaleTimeString()}
              {a.submissionIds.length > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Submission IDs: {a.submissionIds.join(", ")}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="mt-4 max-h-80 overflow-auto text-xs">
          <table className="w-full">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Outcome</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1 pr-2">{new Date(r.at).toLocaleString()}</td>
                  <td className="pr-2">{r.actor_email ?? r.actor_id}</td>
                  <td className="pr-2">{r.action}</td>
                  <td className="pr-2">{r.outcome}</td>
                  <td>
                    {r.detail}
                    {r.submission_id ? ` · ${r.submission_id}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ReviewersPanel() {
  const qc = useQueryClient();
  const list = useServerFn(listReviewers),
    invite = useServerFn(inviteReviewer),
    revoke = useServerFn(revokeReviewer);
  const { data } = useQuery({ queryKey: ["reviewers"], queryFn: () => list() });
  const [email, setEmail] = useState("");
  const run = async (p: Promise<unknown>, msg: string) => {
    try {
      await p;
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ["reviewers"] });
      qc.invalidateQueries({ queryKey: ["audit"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  };
  return (
    <section className="mt-10 rounded-lg border border-border bg-card p-5">
      <h2 className="text-xl font-semibold">Reviewers</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Authorise an email; that person must register, then verify with an emailed code. Revoking
        takes effect immediately and signs them out everywhere.
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {data?.active.map((r) => (
          <li key={r.userId} className="flex items-center justify-between gap-2">
            <span>{r.email}</span>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => run(revoke({ data: { userId: r.userId } }), "Access revoked")}
            >
              Revoke
            </Button>
          </li>
        ))}
        {data?.pending.map((e) => (
          <li key={e} className="flex items-center justify-between gap-2">
            <span>
              {e} <Badge variant="outline">awaiting verification</Badge>
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => run(revoke({ data: { email: e } }), "Withdrawn")}
            >
              Withdraw
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <Input
          placeholder="reviewer@example.org"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button
          onClick={() =>
            run(
              invite({ data: { email } }).then(() => setEmail("")),
              "Authorised",
            )
          }
        >
          Authorise
        </Button>
      </div>
    </section>
  );
}

type Item = {
  id: string;
  title: string;
  kind: string;
  category: string;
  abstract: string;
  keywords: string;
  status: string;
  dean_notes: string;
  file_path: string | null;
  created_at: string;
  confidential: boolean;
  author?: { title: string; full_name: string; parish: string } | undefined;
};

function ReviewItem({ s }: { s: Item }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(s.dean_notes);
  const update = async (patch: { status?: string; confidential?: boolean }) => {
    const { error } = await supabase
      .from("submissions")
      .update({ ...patch, dean_notes: notes.slice(0, 2000) })
      .eq("id", s.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Updated");
    qc.invalidateQueries({ queryKey: ["review"] });
  };
  return (
    <li className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-serif text-xl font-semibold">{s.title}</span>
        <Badge variant="outline">{s.kind}</Badge>
        <StatusBadge status={s.status} />
        {s.confidential && <Badge variant="destructive">Confidential</Badge>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {s.author ? `${s.author.title} ${s.author.full_name}, ${s.author.parish}` : "Unknown"} ·{" "}
        {s.category} · {new Date(s.created_at).toLocaleDateString()}
      </p>
      <p className="mt-3 whitespace-pre-wrap text-sm">{s.abstract}</p>
      {s.file_path && (
        <Button size="sm" variant="outline" className="mt-3" onClick={() => openFile(s.id)}>
          Open document
        </Button>
      )}
      <Textarea
        className="mt-3"
        rows={2}
        placeholder="Note to the author (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => update({ status: "under_review" })}>
          Mark under review
        </Button>
        <Button size="sm" onClick={() => update({ status: "accepted" })}>
          {s.confidential ? "Accept (stays confidential)" : "Accept & share"}
        </Button>
        <Button size="sm" variant="destructive" onClick={() => update({ status: "returned" })}>
          Return to author
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => update({ confidential: !s.confidential })}
        >
          {s.confidential ? "Remove confidential flag" : "Mark confidential"}
        </Button>
      </div>
    </li>
  );
}
