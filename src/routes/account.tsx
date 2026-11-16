import { PageHeader } from "@/components/workspace";
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
        .catch(() => {
          setStatus("error");
          setCanApprove(false);
          setCanReview(false);
          setCanManageSettings(false);
        });
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
      "Your account is approved. Prepare submissions, attach PDFs and send your work for theological review, or browse accepted resources.",
    rejected:
      "Your account is not eligible for application access. Contact the Diocese for assistance.",
    suspended: "Your account is unavailable. Contact the Diocese for assistance.",
    incomplete:
      "Your account profile needs to be completed. Access remains restricted until registration and approval are complete.",
    error:
      "We could not check your account. Refresh the page to try again. Access remains restricted.",
  };
  return (
    <main className="workspace-shell !max-w-4xl">
      <PageHeader
        eyebrow="TEFT · Cape Town"
        title="Clergy account"
        description="Your submissions, shared resources and account access."
      />
      <div className="notice" role="status">
        {status === "pending" && (
          <h2 className="mb-2 text-xl font-semibold">Thank you for registering</h2>
        )}
        {messages[status] ?? messages["error"]}
        {status === "pending" && (
          <p className="mt-3 text-sm text-muted-foreground">
            There is nothing further to submit here. Please contact the Diocese if your registration
            details need to change.
          </p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {status === "approved" && (
          <a className="account-action" href="/submissions">
            <strong>My submissions</strong>
            <span>Prepare a resource, check your PDFs and follow feedback from TEFT.</span>
          </a>
        )}
        {status === "approved" && (
          <a className="account-action" href="/repository">
            <strong>Browse repository</strong>
            <span>Discover accepted, non-confidential resources for your ministry.</span>
          </a>
        )}
        {canReview && (
          <a className="account-action" href="/reviewer">
            <strong>Reviewer workspace</strong>
            <span>Open the current revisions assigned to you for theological review.</span>
          </a>
        )}
        {canManageSettings && (
          <a className="account-action" href="/admin/settings/email">
            <strong>Manage application email</strong>
            <span>Review sender details and notification settings.</span>
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
          <a className="account-action" href="/admin/registrations">
            <strong>Manage clergy registrations</strong>
            <span>Review pending registrations and account access.</span>
          </a>
        )}
      </div>
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
