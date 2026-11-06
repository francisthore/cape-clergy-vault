import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export const Route = createFileRoute("/admin/settings/email")({ component: EmailSettingsPage });
type Settings = {
  version: number;
  sending_domain: string;
  display_name: string;
  from_email: string;
  reply_to: string;
  transactional_enabled: boolean;
  notifications_enabled: boolean;
  updated_at: string;
  updated_by: string | null;
};
function EmailSettingsPage() {
  const [data, setData] = useState<{
    settings: Settings;
    providerStatus: string;
    history: (Omit<Settings, "updated_at" | "updated_by"> & {
      actor_id: string;
      created_at: string;
    })[];
    domains: { domain: string; authorized_at: string | null }[];
  } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    setData(null);
    try {
      const r = await fetch("/api/settings/email", { cache: "no-store" });
      const v = await r.json();
      if (!r.ok) throw Error(v.message);
      setData(v);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unavailable");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function send(test = false) {
    if (!data || busy) return;
    setBusy(true);
    setMessage("");
    const s = data.settings;
    try {
      const r = await fetch("/api/settings/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          test
            ? { action: "test" }
            : {
                version: s.version,
                sendingDomain: s.sending_domain,
                displayName: s.display_name,
                fromEmail: s.from_email,
                replyTo: s.reply_to,
                transactionalEnabled: s.transactional_enabled,
                notificationsEnabled: s.notifications_enabled,
              },
        ),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.message);
      setMessage(v.message);
      if (!test) await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unavailable");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <h1 className="text-3xl text-primary">Application email settings</h1>
      <a href="/account" className="text-primary underline">
        Account
      </a>
      <p>
        Sign in within the last 15 minutes to save or test. Credentials remain in the protected
        server environment; replacement through this page is unavailable.
      </p>
      {!data ? (
        <div>
          <p role="status">{loading ? "Loading email settings…" : "Settings are unavailable."}</p>
          <Button disabled={loading} onClick={() => void load()}>
            Reload settings
          </Button>
        </div>
      ) : (
        <>
          <p>Provider: {data.providerStatus}</p>
          <p>
            Authorized domains:{" "}
            {data.domains
              .filter((d) => d.authorized_at)
              .map((d) => d.domain)
              .join(", ") || "Awaiting operator verification"}
          </p>
          <form
            className="space-y-4 rounded-lg border bg-card p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            {(
              [
                ["sending_domain", "Sending domain"],
                ["display_name", "From display name"],
                ["from_email", "From email"],
                ["reply_to", "Reply-to email"],
              ] as const
            ).map(([key, label]) => (
              <label className="block" key={key} htmlFor={key}>
                {label}
                <Input
                  id={key}
                  value={data.settings[key]}
                  type={key.includes("email") || key === "reply_to" ? "email" : "text"}
                  required={key !== "reply_to"}
                  maxLength={key === "display_name" ? 100 : 254}
                  disabled={busy}
                  onChange={(e) =>
                    setData({ ...data, settings: { ...data.settings, [key]: e.target.value } })
                  }
                />
              </label>
            ))}
            {(
              [
                [
                  "transactional_enabled",
                  "Transactional email enabled — confirm this exact sender before live delivery",
                ],
                ["notifications_enabled", "Optional approval notifications enabled"],
              ] as const
            ).map(([key, label]) => (
              <label className="flex gap-3" key={key}>
                <input
                  type="checkbox"
                  checked={data.settings[key]}
                  disabled={busy}
                  onChange={(e) =>
                    setData({ ...data, settings: { ...data.settings, [key]: e.target.checked } })
                  }
                />
                {label}
              </label>
            ))}
            <p>
              Updated {new Date(data.settings.updated_at).toLocaleString()} by{" "}
              {data.settings.updated_by ?? "initial defaults"} · Version {data.settings.version}
            </p>
            <Button disabled={busy}>{busy ? "Working…" : "Save settings"}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}>
              Reload
            </Button>
          </form>
          <Button
            className="h-auto min-h-10 max-w-full whitespace-normal py-2"
            disabled={busy}
            onClick={() => void send(true)}
          >
            Test saved configuration to my verified address
          </Button>
          <p>Provider acceptance does not confirm delivery.</p>
          <h2 className="text-xl">Configuration history</h2>
          <ul>
            {data.history.map((h) => (
              <li key={h.version}>
                <details>
                  <summary>
                    Version {h.version} · {new Date(h.created_at).toLocaleString()} · {h.actor_id}
                  </summary>
                  <p>
                    {h.display_name} &lt;{h.from_email}&gt; · Domain: {h.sending_domain}
                  </p>
                  <p>
                    Reply-to: {h.reply_to || "None"} · Transactional:{" "}
                    {h.transactional_enabled ? "enabled" : "disabled"} · Notifications:{" "}
                    {h.notifications_enabled ? "enabled" : "disabled"}
                  </p>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </main>
  );
}
