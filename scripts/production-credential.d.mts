export function readProductionCredential(
  path: string,
  service: "web" | "scanner" | "approval" | "reviewer" | "operator",
  name: "database-password" | "auth-secret" | "bouncer-key" | "resend-key",
): Promise<string>;
