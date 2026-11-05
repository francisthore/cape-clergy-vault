export type RegistrationStatus = "pending" | "approved" | "rejected" | "suspended";
export type Registration = {
  user_id: string;
  full_name: string;
  title: string;
  parish: string;
  email: string;
  email_verified: boolean;
  approval_status: RegistrationStatus;
  created_at: string;
};
export type RegistrationDetail = Registration & {
  history: {
    id: string;
    status: RegistrationStatus;
    reason: string;
    created_at: string;
    actor_id: string;
    actor_name: string;
  }[];
};
export async function registrationRequest<T>(
  query: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/registrations${query}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    ...(signal ? { signal } : {}),
    ...(body
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "Administration unavailable.");
  return result as T;
}
