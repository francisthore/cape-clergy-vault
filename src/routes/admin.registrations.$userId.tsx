import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { registrationRequest, type RegistrationDetail } from "@/lib/approvals/types";
export const Route = createFileRoute("/admin/registrations/$userId")({
  component: RegistrationPage,
});
type Action = "approve" | "reject" | "suspend" | "reactivate";
function RegistrationPage() {
  const { userId } = Route.useParams();
  const [data, setData] = useState<RegistrationDetail>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<Action>();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  // Reuse the request ID across uncertain transport failures; a new dialog starts a new intent.
  const requestId = useRef("");
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined);
    setError("");
    void registrationRequest<RegistrationDetail>(
      `?id=${encodeURIComponent(userId)}`,
      undefined,
      controller.signal,
    )
      .then(setData)
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [userId, refresh]);
  useEffect(() => {
    const update = () => {
      if (!submitting.current) setRefresh((v) => v + 1);
    };
    const timer = setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  async function decide() {
    if (!action || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setNotice("");
    try {
      await registrationRequest("", {
        targetId: userId,
        action,
        reason,
        requestId: requestId.current,
      });
      setNotice("Decision recorded. Notification queued.");
      setAction(undefined);
      setReason("");
      setRefresh((v) => v + 1);
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Decision failed. Refresh and check the current status.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const actions: Action[] =
    data?.approval_status === "pending"
      ? ["approve", "reject"]
      : data?.approval_status === "approved"
        ? ["suspend"]
        : data?.approval_status === "suspended"
          ? ["reactivate"]
          : [];
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <Link className="text-primary underline" to="/admin/registrations">
        All registrations
      </Link>
      <h1 className="text-4xl font-semibold text-primary">Registration review</h1>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p role="status">Loading registration…</p>
      ) : (
        <>
          <section className="space-y-3 rounded-lg border bg-card p-6" aria-label="Clergy profile">
            <h2 className="text-2xl">
              {data.title} {data.full_name}
            </h2>
            <p>{data.parish}</p>
            <p className="break-all">{data.email}</p>
            <p>Email {data.email_verified ? "verified" : "unverified"}</p>
            <p className="font-semibold">Status: {data.approval_status}</p>
            <p>Registered {new Date(data.created_at).toLocaleString("en-ZA")}</p>
          </section>
          <section className="space-y-3" aria-label="Approval decision">
            <p>
              Approval manages clergy access. Reviewer and system permissions are managed
              separately.
            </p>
            {actions.length > 0 && (
              <>
                <label className="block" htmlFor="decision-reason">
                  Decision reason (required for rejection, suspension and reactivation)
                </label>
                <Textarea
                  id="decision-reason"
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="flex flex-wrap gap-3">
                  {actions.map((a) => (
                    <Button
                      key={a}
                      disabled={
                        busy || (a === "approve" ? !data.email_verified : reason.trim().length < 3)
                      }
                      onClick={() => {
                        requestId.current = crypto.randomUUID();
                        setAction(a);
                      }}
                    >
                      {a[0]!.toUpperCase() + a.slice(1)}
                    </Button>
                  ))}
                </div>
              </>
            )}
            {data.approval_status === "rejected" && (
              <p>Rejected registrations cannot be approved through this workflow.</p>
            )}
          </section>
          <section aria-label="Approval history">
            <h2 className="mb-4 text-2xl font-semibold">Approval history</h2>
            <ol className="space-y-3">
              {data.history.map((event) => (
                <li key={event.id} className="rounded-lg border p-4">
                  <p className="font-semibold">
                    {event.status} · {event.actor_name}
                  </p>
                  <p>{new Date(event.created_at).toLocaleString("en-ZA")}</p>
                  <p className="whitespace-pre-wrap break-words">{event.reason}</p>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      <AlertDialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Confirm {action}</AlertDialogTitle>
          <AlertDialogDescription>
            This will change access for {data?.full_name} and record your decision permanently.
            {action === "suspend" && " Active sessions will be revoked."}
          </AlertDialogDescription>
          <p className="whitespace-pre-wrap break-words">{reason}</p>
          {notice && <p role="status">{notice}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void decide();
              }}
            >
              {busy ? "Recording…" : "Confirm decision"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
