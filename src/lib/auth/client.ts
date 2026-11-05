import { createAuthClient } from "better-auth/react";
// Same-origin HTTP cookies; no localStorage/sessionStorage credentials.
export const authClient = createAuthClient();
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
    canApprove?: boolean;
    canManageSettings?: boolean;
    message?: string;
    ok?: boolean;
  };
  if (!response.ok) throw new Error(data.message || "Request failed. Try again.");
  return data;
}
