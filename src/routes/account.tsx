import { profileValues } from "@/lib/auth/registration";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { accountRequest } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { ProfileFields, PrivacyAcknowledgement } from "@/components/RegistrationFields";
export const Route = createFileRoute("/account")({ component: AccountPage });
function AccountPage() {
  const [status, setStatus] = useState("loading");
  const [canManageSettings, setCanManageSettings] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const [canApprove, setCanApprove] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const refresh = () => {
      void accountRequest("account")
        .then((r) => {
          setStatus(r.status ?? "error");
          setCanApprove(r.canApprove === true);
          setCanReview(r.canReview === true);
          setCanManageSettings(r.canManageSettings === true);
        })
        .catch(() => setStatus("error"));
    };
    refresh();
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  async function complete(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const result = await accountRequest("complete-profile", profileValues(form));
      setStatus(result.status!);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please try again");
    } finally {
      setBusy(false);
    }
  }
  const messages: Record<string, string> = {
    loading: "Loading your account…",
    "signed-out": "Your session has ended. Please sign in.",
    pending:
      "Your registration is awaiting Diocese approval. You will be notified once your account has been approved.",
    approved:
      "Your account is approved. Create drafts, attach PDFs and submit your work, or browse accepted resources.",
    rejected:
      "Your account is not eligible for application access. Contact the Diocese for assistance.",
    suspended: "Your account is unavailable. Contact the Diocese for assistance.",
    incomplete:
      "Your account profile needs to be completed. Access remains restricted until registration and approval are complete.",
    error:
      "We could not check your account. Refresh the page to try again. Access remains restricted.",
  };
  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-12">
      <h1 className="text-4xl font-semibold text-primary">Clergy account</h1>
      <p role="status">{messages[status] ?? messages["error"]}</p>
      {status === "approved" && (
        <a className="block text-primary underline" href="/submissions">
          My submissions
        </a>
      )}
      {status === "approved" && (
        <a className="block text-primary underline" href="/repository">
          Browse repository
        </a>
      )}
      {canReview && (
        <a className="block text-primary underline" href="/reviewer">
          Reviewer workspace
        </a>
      )}
      {canManageSettings && (
        <a className="block text-primary underline" href="/admin/settings/email">
          Manage application email
        </a>
      )}
      {status === "incomplete" && (
        <form onSubmit={complete} className="space-y-4 rounded-lg border bg-card p-6">
          <ProfileFields />
          <PrivacyAcknowledgement />
          <Button disabled={busy}>{busy ? "Saving…" : "Complete registration"}</Button>
        </form>
      )}
      {canApprove && (
        <a className="block text-primary underline" href="/admin/registrations">
          Manage clergy registrations
        </a>
      )}
      {message && <p role="alert">{message}</p>}
      {status === "signed-out" ? (
        <a className="text-primary underline" href="/auth?view=login">
          Sign in
        </a>
      ) : (
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await accountRequest("sign-out", {});
              window.location.assign("/auth?view=login");
            } catch {
              setMessage("Sign-out failed. Please try again.");
              setBusy(false);
            }
          }}
        >
          Sign out
        </Button>
      )}
    </main>
  );
}
