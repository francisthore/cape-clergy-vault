import { useState } from "react";
import { useAccount } from "@/lib/auth/account-context";
import { PageHeader, WorkspaceSection } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdministration, useAdministrationAction } from "./useAdministration";
type Identity = {
  isSelf: boolean;
  id: string;
  email: string;
  verified: boolean;
  name: string;
  approval: string;
  eligible: boolean;
  capabilities: string[];
  delegated: string[];
  invitations: { id: string; state: string; expires_at: string; created_at: string }[];
};
export function AccessManagement() {
  const account = useAccount();
  const [lookup, setLookup] = useState("");
  const [identity, setIdentity] = useState("");
  const [capability, setCapability] = useState("reviewer");
  const [operation, setOperation] = useState("invite");
  const [invitationId, setInvitationId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const { data, message, checking, refresh } = useAdministration<Identity>(
    account.canManageAccess && identity ? `view=identity&id=${encodeURIComponent(identity)}` : null,
  );
  const action = useAdministrationAction();
  const required = data ? `${operation.toUpperCase()} ${data.id} ${capability}` : "";
  return (
    <main className="workspace-shell !max-w-4xl">
      <a className="back-link" href="/admin">
        ← TEFT Administration
      </a>
      <PageHeader
        eyebrow="TEFT Administration"
        title="Manage delegated access"
        description="Independently verify the person and exact registered identity before confirming an operation. Reviewer access always requires a mailbox invitation and explicit acceptance."
      />
      {!account.canManageAccess ? (
        <p role="status">
          {account.status === "loading"
            ? "Checking account…"
            : "Current delegated access-management authorization is required."}
        </p>
      ) : (
        <>
          <WorkspaceSection title="Find an exact registered identity">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                setConfirmation("");
                if (identity === lookup.trim()) void refresh();
                else setIdentity(lookup.trim());
              }}
            >
              <label className="block" htmlFor="identity">
                Exact account ID
                <Input
                  id="identity"
                  value={lookup}
                  maxLength={200}
                  required
                  disabled={action.busy}
                  onChange={(e) => setLookup(e.target.value)}
                />
              </label>
              <Button disabled={checking || action.busy}>Inspect identity</Button>
            </form>
          </WorkspaceSection>
          {checking && <p role="status">Checking live identity and capabilities…</p>}
          {message && <p role="alert">{message}</p>}
          {data && (
            <WorkspaceSection
              title={data.name}
              description="Verify these details against your independently trusted identity record."
            >
              <p className="break-all">Account ID: {data.id}</p>
              <p className="break-all">
                Mailbox: {data.email} · {data.verified ? "Verified" : "Unverified"}
              </p>
              <p>
                Registration: {data.approval} ·{" "}
                {data.eligible
                  ? "Current clergy consent and eligibility confirmed"
                  : "Not currently eligible for new access"}
              </p>
              <p>Active capabilities: {data.capabilities.join(", ") || "None"}</p>
              <p>
                You may manage only: {data.delegated.join(", ") || "No delegated capabilities"}.
              </p>
              <h3 className="font-semibold">Reviewer invitation and activation history</h3>
              <p className="text-sm">
                An accepted invitation is historical evidence. The active reviewer capability and
                live eligibility determine current access. Pending invitations expire one hour after
                issue. Queued mail does not prove inbox delivery.
              </p>
              <ul className="space-y-2">
                {data.invitations.map((i) => (
                  <li className="rounded border p-3 text-sm" key={i.id}>
                    <p className="break-all">
                      {i.id} · {i.state}
                    </p>
                    <p>
                      Issued {new Date(i.created_at).toLocaleString()} · Expires{" "}
                      {new Date(i.expires_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
              <form
                className="space-y-4 border-t pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (
                    confirmation !== required ||
                    !data.delegated.includes(capability) ||
                    (data.isSelf && operation !== "cancel-invitation")
                  )
                    return;
                  void action
                    .run(
                      {
                        action: "access",
                        operation,
                        identity: data.id,
                        capability,
                        mailbox: data.email,
                        confirmation,
                        reason,
                        ...(operation === "cancel-invitation" ? { invitationId } : {}),
                      },
                      refresh,
                    )
                    .then((ok) => {
                      if (ok) setConfirmation("");
                    });
                }}
              >
                <label className="block" htmlFor="capability">
                  Delegated capability
                  <select
                    id="capability"
                    className="block w-full rounded border bg-background p-2"
                    value={capability}
                    disabled={action.busy}
                    onChange={(e) => {
                      setCapability(e.target.value);
                      setOperation(e.target.value === "reviewer" ? "invite" : "grant");
                      setConfirmation("");
                    }}
                  >
                    {["reviewer", "approver", "review_coordinator", "settings_manager"].map((c) => (
                      <option value={c} key={c} disabled={!data.delegated.includes(c)}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block" htmlFor="operation">
                  Operation
                  <select
                    id="operation"
                    className="block w-full rounded border bg-background p-2"
                    value={operation}
                    disabled={action.busy}
                    onChange={(e) => {
                      setOperation(e.target.value);
                      setConfirmation("");
                    }}
                  >
                    {(capability === "reviewer"
                      ? [
                          ["invite", "Invite reviewer"],
                          ["cancel-invitation", "Cancel pending invitation"],
                          ["revoke", "Revoke reviewer access and assignments"],
                        ]
                      : [
                          ["grant", "Grant capability"],
                          ["revoke", "Revoke capability"],
                        ]
                    ).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {operation === "cancel-invitation" && (
                  <label className="block" htmlFor="invitation">
                    Pending invitation
                    <select
                      id="invitation"
                      className="block w-full rounded border bg-background p-2"
                      value={invitationId}
                      required
                      onChange={(e) => setInvitationId(e.target.value)}
                    >
                      <option value="">Choose invitation</option>
                      {data.invitations
                        .filter((i) => i.state === "pending" || i.state === "expired")
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.id}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label className="block" htmlFor="reason">
                  Reason and identity verification evidence
                  <textarea
                    className="block w-full rounded border bg-background p-2"
                    id="reason"
                    minLength={10}
                    maxLength={1000}
                    value={reason}
                    required
                    disabled={action.busy}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <p className="text-sm">
                  Record how the exact identity was verified without passwords, proof links or
                  sensitive submission details. Access managers cannot grant system admin,
                  access-manager authority or reviewer status directly. Self-grants and
                  self-revocation and self-invitation are prohibited. Another authorized access
                  manager must invite you.
                </p>
                <label className="block break-words" htmlFor="confirmation">
                  Type {required} to confirm
                  <Input
                    id="confirmation"
                    value={confirmation}
                    required
                    autoComplete="off"
                    disabled={action.busy}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
                <Button
                  disabled={
                    action.busy ||
                    (data.isSelf && operation !== "cancel-invitation") ||
                    confirmation !== required ||
                    !data.delegated.includes(capability) ||
                    ((operation === "grant" || operation === "invite") && !data.eligible)
                  }
                >
                  {action.busy ? "Recording…" : "Confirm access operation"}
                </Button>
              </form>
            </WorkspaceSection>
          )}
        </>
      )}
      {action.message && (
        <p className="notice" role="status">
          {action.message}
        </p>
      )}
    </main>
  );
}
