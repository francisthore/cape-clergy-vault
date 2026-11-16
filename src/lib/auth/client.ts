import { createAuthClient } from "better-auth/react";
// Same-origin HTTP cookies; no localStorage/sessionStorage credentials.
export const authClient = createAuthClient();
export type AccountState = {
  status: string;
  canApprove?: boolean;
  canReview?: boolean;
  canManageSettings?: boolean;
  canUseRepository?: boolean;
};
export async function accountRequest(path: string, body?: unknown) {
  const response = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = (await response.json()) as {
    status?: string;
    canUseRepository?: boolean;
    canApprove?: boolean;
    canReview?: boolean;
    canManageSettings?: boolean;
    message?: string;
    ok?: boolean;
  };
  if (!response.ok) throw new Error(data.message || "Request failed. Try again.");
  if (body !== undefined && typeof window !== "undefined")
    window.dispatchEvent(new Event("cape-account-changed"));
  return data;
}
