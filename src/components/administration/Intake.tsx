import { useState } from "react";
import { useAccount } from "@/lib/auth/account-context";
import { PageHeader, WorkspaceSection } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useAdministration, useAdministrationAction } from "./useAdministration";
type Assignment = {
  id: string;
  reviewerId: string;
  assignedBy: string;
  createdAt: string;
  status: string;
  eligible: boolean;
};
type Item = {
  id: string;
  title: string;
  revision: number;
  status: string;
  confidential: boolean;
  submitted_at: string;
  assignments: Assignment[];
};
type Inbox = {
  total: number;
  unassigned: number;
  items: Item[];
  reviewers: { user_id: string; full_name: string; parish: string }[];
};
export function Intake() {
  const account = useAccount();
  const [page, setPage] = useState(1);
  const { data, message, checking, refresh } = useAdministration<Inbox>(
    account.canCoordinate ? `view=intake&page=${page}` : null,
  );
  const action = useAdministrationAction();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<{
    body: Record<string, unknown>;
    title: string;
    description: string;
  } | null>(null);
  return (
    <main className="workspace-shell">
      <a className="back-link" href="/admin">
        ← TEFT Administration
      </a>
      <PageHeader
        eyebrow="TEFT Administration"
        title="TEFT submission inbox"
        description="Assign eligible theological reviewers to a deliberately confirmed revision. Coordination provides routing information; document access requires a separate review assignment."
      />
      {!account.canCoordinate ? (
        <p role="status">
          {account.status === "loading"
            ? "Checking account…"
            : "Current submission-coordinator authorization is required."}
        </p>
      ) : (
        <>
          <Button
            variant="outline"
            disabled={checking || action.busy}
            onClick={() => void refresh()}
          >
            Refresh intake
          </Button>
          {checking && <p role="status">Checking current intake…</p>}
          {message && <p role="alert">{message}</p>}
          {data && (
            <>
              <p role="status">
                {data.unassigned} awaiting assignment · {data.total} submitted or in review
              </p>
              {!data.items.length && <p>No resources awaiting coordination.</p>}
              {!data.reviewers.length && (
                <p className="notice">
                  No eligible reviewers. A delegated access manager must invite an approved clergy
                  identity; they must accept the mailbox invitation before assignment.
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Reviewer choices show at most 200 eligible identities. Coordinators may explicitly
                assign themselves to another author’s resource if independently activated as a
                reviewer. Self-review is prohibited.
              </p>
              {data.items.map((item) => (
                <WorkspaceSection
                  key={item.id}
                  title={item.title}
                  description={`Revision ${item.revision} · ${item.status === "under_review" ? "Theological review in progress" : "Sent to TEFT"}`}
                >
                  <p className="break-all text-sm">Reference: {item.id}</p>
                  <p className="text-sm">Sent {new Date(item.submitted_at).toLocaleString()}</p>
                  {item.confidential && (
                    <p className="text-sm">
                      Confidential routing record. Title, author details, description and PDFs are
                      withheld from this inbox.
                    </p>
                  )}
                  <ul className="space-y-2">
                    {item.assignments.map((a) => (
                      <li key={a.id} className="rounded border p-3 text-sm">
                        <p className="break-all">
                          Reviewer:{" "}
                          {data.reviewers.find((r) => r.user_id === a.reviewerId)?.full_name ??
                            a.reviewerId}
                        </p>
                        <p>
                          {a.status === "active"
                            ? a.eligible
                              ? "Active assignment"
                              : "Assignment no longer eligible"
                            : "Revoked assignment"}
                        </p>
                        <p className="break-all">
                          Assigned by {a.assignedBy} · {new Date(a.createdAt).toLocaleString()}
                        </p>
                        {a.status === "active" && (
                          <Button
                            variant="outline"
                            disabled={action.busy}
                            onClick={() =>
                              setConfirmation({
                                body: { action: "revoke-assignment", id: a.id },
                                title: "Revoke this assignment?",
                                description: `Remove reviewer ${a.reviewerId} from resource ${item.id}, revision ${item.revision}. Review evidence is retained.`,
                              })
                            }
                          >
                            Revoke assignment
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <label className="block" htmlFor={`reviewer-${item.id}`}>
                    Eligible reviewer
                    <select
                      id={`reviewer-${item.id}`}
                      className="block w-full rounded border bg-background p-2"
                      value={selected[item.id] ?? ""}
                      disabled={action.busy}
                      onChange={(e) => setSelected({ ...selected, [item.id]: e.target.value })}
                    >
                      <option value="">Choose an eligible reviewer</option>
                      {data.reviewers.map((r) => (
                        <option key={r.user_id} value={r.user_id}>
                          {r.full_name} · {r.parish} · {r.user_id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    disabled={action.busy || !selected[item.id]}
                    onClick={() =>
                      setConfirmation({
                        body: {
                          action: "assign",
                          id: item.id,
                          revision: item.revision,
                          reviewerId: selected[item.id],
                        },
                        title: "Assign this exact revision?",
                        description: `Assign reviewer ${selected[item.id]} to resource ${item.id}, revision ${item.revision}. This grants review access to this revision, including any clean confidential PDFs. SQL rechecks reviewer eligibility and prohibits the author from reviewing their own work.`,
                      })
                    }
                  >
                    Assign reviewer
                  </Button>
                </WorkspaceSection>
              ))}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  disabled={page === 1 || action.busy}
                  onClick={() => setPage(page - 1)}
                >
                  Previous page
                </Button>
                <p>Page {page}</p>
                <Button
                  variant="outline"
                  disabled={page * 20 >= data.total || action.busy}
                  onClick={() => setPage(page + 1)}
                >
                  Next page
                </Button>
              </div>
            </>
          )}
        </>
      )}
      {action.message && (
        <p className="notice" role="status">
          {action.message}
        </p>
      )}
      <AlertDialog
        open={!!confirmation && !!data && !!account.canCoordinate}
        onOpenChange={(open) => {
          if (!open && !action.busy) setConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {confirmation?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={action.busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={action.busy || !data || !account.canCoordinate}
              onClick={(e) => {
                e.preventDefault();
                if (confirmation)
                  void action.run(confirmation.body, refresh).then((ok) => {
                    if (ok) setConfirmation(null);
                  });
              }}
            >
              Confirm operation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
