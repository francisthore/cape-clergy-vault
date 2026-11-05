import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { reviewRequest } from "@/lib/reviews/client";
export const Route = createFileRoute("/reviewer/invitation")({
  head: () => ({
    meta: [
      { title: "Reviewer invitation — Cape Clergy Vault" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Invitation,
});
function Invitation() {
  const token = useRef(""),
    [inv, setInv] = useState<{ state: string; mailbox: string; expiresAt: string } | null>(null),
    [message, setMessage] = useState("Checking invitation…"),
    [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState(false),
    [ack, setAck] = useState(false);
  useEffect(() => {
    // Fragment is never sent in HTTP requests, SSR, referrers or analytics. Keep proof
    // only in this component's memory and remove it from the current history entry.
    if (!token.current) {
      token.current = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
    let active = true;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token.current)) {
      setMessage("Open the original invitation link from your email.");
      return;
    }
    void reviewRequest({ action: "inspect-invitation", token: token.current })
      .then((r) => {
        if (active) {
          setInv(r.invitation);
          setMessage("");
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function accept() {
    if (busy || !ack || inv?.state !== "pending") return;
    setBusy(true);
    try {
      const r = await reviewRequest({ action: "accept-invitation", token: token.current });
      token.current = "";
      setAccepted(true);
      setMessage(r.message);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Invitation unavailable.");
      setInv(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <p className="text-sm text-primary">Anglican Diocese of Cape Town</p>
      <h1 className="text-4xl font-semibold text-primary">Reviewer invitation</h1>
      <p>
        Theological reviewers assess resources assigned to them, preserve confidentiality and
        provide clear, respectful feedback. Each assignment applies to a specific revision.
      </p>
      <p>
        Reviewers cannot review their own work. Reviewer authorization does not grant registration
        approval or email-management permissions.
      </p>
      {inv && (
        <section className="space-y-4 rounded-lg border bg-card p-6">
          <p>Invited account: {inv.mailbox}</p>
          <p>Invitation expires {new Date(inv.expiresAt).toLocaleString()}.</p>
          {inv.state === "pending" ? (
            <>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                  disabled={busy}
                />
                I accept these reviewer responsibilities and agree to protect the confidential
                material entrusted to me.
              </label>
              <Button disabled={busy || !ack} onClick={() => void accept()}>
                {busy ? "Accepting…" : "Accept reviewer invitation"}
              </Button>
            </>
          ) : (
            <p role="status">
              {inv.state === "accepted"
                ? "This invitation has already been used."
                : inv.state === "expired"
                  ? "This invitation has expired. Ask the trusted operator to issue a new invitation."
                  : "This invitation has been revoked. Contact the trusted operator."}
            </p>
          )}
        </section>
      )}
      {message && <p role="status">{message}</p>}
      {accepted ? (
        <a className="text-primary underline" href="/reviewer">
          Open reviewer workspace
        </a>
      ) : (
        <p>
          Sign in with the invited, verified, approved account first. If you need to sign in or the
          account is ineligible, visit{" "}
          <a className="text-primary underline" href="/account">
            your account
          </a>{" "}
          and then reopen the original email link. An invitation for another identity cannot be
          accepted here.
        </p>
      )}
    </main>
  );
}
