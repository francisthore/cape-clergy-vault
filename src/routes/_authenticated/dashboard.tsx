import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { PopiaNotice } from "@/components/PopiaNotice";
import { POPIA_VERSION, submissionSchema, fileAllowed } from "@/lib/popia";
import { StatusBadge, openFile } from "@/components/submission-utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "My submissions — Theological Repository" },
      { name: "description", content: "Submit documents and ideas to the Dean." },
      { property: "og:title", content: "My submissions — Theological Repository" },
      { property: "og:description", content: "Submit documents and ideas to the Dean." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

export const CATEGORIES = [
  "Sermon / Homily",
  "Research paper",
  "Liturgy & worship",
  "Pastoral care",
  "Biblical studies",
  "Church history",
  "Ethics & society",
  "Idea / Proposal",
  "General",
];

function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Please sign in again");
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", u.user.id)
        .maybeSingle();
      return { user: u.user, profile: data };
    },
  });
}

function Dashboard() {
  const { data, isLoading } = useProfile();
  if (isLoading || !data)
    return <main className="mx-auto max-w-5xl px-6 py-12 text-muted-foreground">Loading…</main>;
  if (!data.profile?.popia_accepted_at || data.profile.popia_version !== POPIA_VERSION)
    return <ConsentGate userId={data.user.id} initial={data.profile} />;
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-4xl font-semibold text-primary">
        Peace be with you, {data.profile.title} {data.profile.full_name}
      </h1>
      <p className="mt-1 text-muted-foreground">
        {data.profile.parish} · POPIA acknowledged{" "}
        {new Date(data.profile.popia_accepted_at).toLocaleDateString()}
      </p>
      <div className="mt-10 grid gap-10 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <SubmitForm userId={data.user.id} />
        </div>
        <div className="lg:col-span-3">
          <MySubmissions />
        </div>
      </div>
    </main>
  );
}

function ConsentGate({
  userId,
  initial,
}: {
  userId: string;
  initial: { title: string; full_name: string; parish: string; phone: string } | null;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    title: initial?.title || "Rev.",
    full_name: initial?.full_name || "",
    parish: initial?.parish || "",
    phone: initial?.phone || "",
  });
  const [ok, setOk] = useState(false);
  const save = async () => {
    if (f.full_name.trim().length < 2 || f.parish.trim().length < 2) {
      toast.error("Please complete your name and parish");
      return;
    }
    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      ...f,
      popia_version: POPIA_VERSION,
      popia_accepted_at: new Date().toISOString(),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["profile"] });
  };
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-primary">Complete your clergy registration</h1>
      <p className="mt-2 text-muted-foreground">
        Before you can submit, please confirm your details and acknowledge the POPIA notice.
      </p>
      <div className="mt-6 space-y-4 rounded-lg border border-border bg-card p-6">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Title</Label>
            <Input
              className="mt-1"
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label>Full name</Label>
            <Input
              className="mt-1"
              value={f.full_name}
              onChange={(e) => setF({ ...f, full_name: e.target.value })}
            />
          </div>
        </div>
        <div>
          <Label>Parish / ministry</Label>
          <Input
            className="mt-1"
            value={f.parish}
            onChange={(e) => setF({ ...f, parish: e.target.value })}
          />
        </div>
        <PopiaNotice />
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={ok} onCheckedChange={(v) => setOk(v === true)} className="mt-0.5" />
          <span>
            I have read and understood the POPIA notice and consent to the processing of my personal
            information.
          </span>
        </label>
        <Button className="w-full" disabled={!ok} onClick={save}>
          Acknowledge & continue
        </Button>
      </div>
    </main>
  );
}

function SubmitForm({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    kind: "document" as "document" | "idea",
    title: "",
    category: "Sermon / Homily",
    abstract: "",
    keywords: "",
  });
  const [confidential, setConfidential] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = submissionSchema.safeParse(f);
    if (!p.success) {
      toast.error(p.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    if (f.kind === "document" && !file) {
      toast.error("Please attach your document");
      return;
    }
    if (file && !fileAllowed(file.name, file.size)) {
      toast.error("Use PDF, Word, ODT, RTF or TXT under 25MB");
      return;
    }
    setBusy(true);
    let file_path: string | null = null;
    if (file) {
      file_path = `${userId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage.from("submissions").upload(file_path, file);
      if (error) {
        toast.error(error.message);
        setBusy(false);
        return;
      }
    }
    const { error } = await supabase.from("submissions").insert({
      ...p.data,
      user_id: userId,
      file_path,
      file_name: file?.name ?? null,
      confidential,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Submitted to the Dean for review");
    setF({ ...f, title: "", abstract: "", keywords: "" });
    setFile(null);
    qc.invalidateQueries({ queryKey: ["mine"] });
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-card p-6">
      <h2 className="text-2xl font-semibold">New submission</h2>
      <div className="flex gap-2">
        {(["document", "idea"] as const).map((k) => (
          <Button
            key={k}
            type="button"
            size="sm"
            variant={f.kind === k ? "default" : "outline"}
            onClick={() => setF({ ...f, kind: k })}
          >
            {k === "document" ? "Document" : "Idea"}
          </Button>
        ))}
      </div>
      <div>
        <Label>Title</Label>
        <Input
          className="mt-1"
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
        />
      </div>
      <div>
        <Label>Category</Label>
        <select
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={f.category}
          onChange={(e) => setF({ ...f, category: e.target.value })}
        >
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div>
        <Label>{f.kind === "idea" ? "Describe your idea" : "Abstract / summary"}</Label>
        <Textarea
          className="mt-1"
          rows={5}
          value={f.abstract}
          onChange={(e) => setF({ ...f, abstract: e.target.value })}
        />
      </div>
      <div>
        <Label>Keywords</Label>
        <Input
          className="mt-1"
          placeholder="e.g. Eucharist, reconciliation"
          value={f.keywords}
          onChange={(e) => setF({ ...f, keywords: e.target.value })}
        />
      </div>
      <div>
        <Label>{f.kind === "idea" ? "Supporting file (optional)" : "Document"}</Label>
        <Input
          className="mt-1"
          type="file"
          accept=".pdf,.doc,.docx,.odt,.txt,.rtf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={confidential}
          onCheckedChange={(v) => setConfidential(v === true)}
          className="mt-0.5"
        />
        <span>
          Confidential — only you and authorised reviewers may ever open this, even if accepted.
        </span>
      </label>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Submitting…" : "Submit to the Dean"}
      </Button>
    </form>
  );
}

function MySubmissions() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["mine"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Please sign in again");
      const { data } = await supabase
        .from("submissions")
        .select("*")
        .eq("user_id", u.user.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  const withdraw = async (id: string, path: string | null) => {
    if (path) await supabase.storage.from("submissions").remove([path]);
    await supabase.from("submissions").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["mine"] });
  };
  return (
    <div>
      <h2 className="text-2xl font-semibold">My submissions</h2>
      {!data?.length && (
        <p className="mt-4 text-sm text-muted-foreground">You have not submitted anything yet.</p>
      )}
      <ul className="mt-4 space-y-3">
        {data?.map((s) => (
          <li key={s.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-serif text-lg font-semibold">{s.title}</span>
              <Badge variant="outline">{s.kind}</Badge>
              <StatusBadge status={s.status} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {s.category} · {new Date(s.created_at).toLocaleDateString()}
            </p>
            <p className="mt-2 line-clamp-3 text-sm">{s.abstract}</p>
            {s.dean_notes && (
              <p className="mt-2 rounded bg-muted p-2 text-sm">
                <strong>Dean's note:</strong> {s.dean_notes}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              {s.file_path && (
                <Button size="sm" variant="outline" onClick={() => openFile(s.id)}>
                  Open file
                </Button>
              )}
              {s.status === "submitted" && (
                <Button size="sm" variant="ghost" onClick={() => withdraw(s.id, s.file_path)}>
                  Withdraw
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
