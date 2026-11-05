import type { TransactionSql } from "postgres";
import type { RuntimeConnection } from "./runtime.server.ts";

// Server-only factory: verifier must call Better Auth's session API with request
// headers, never accept a browser-supplied user ID/role. No route uses this yet.
// Revalidation and account disabling/session revocation integration are Phase 3.
export function createRequestDatabaseBoundary(
  connection: RuntimeConnection,
  verifySession: (headers: Headers) => Promise<{ user: { id: string } } | null>,
) {
  return async function withRequestDatabase<T>(
    headers: Headers,
    operation: (tx: TransactionSql) => Promise<T>,
  ): Promise<T> {
    const session = await verifySession(headers);
    if (!session?.user.id) throw new Error("Authenticated server session required");
    const result = await connection.client.begin(async (tx) => {
      // SET LOCAL via set_config(..., true) is reset on commit AND rollback.
      await tx`select set_config('cape.user_id', ${session.user.id}, true)`;
      return operation(tx);
    });
    return result as T;
  };
}
