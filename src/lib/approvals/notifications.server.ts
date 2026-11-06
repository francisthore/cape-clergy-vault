import type { Sql } from "postgres";
import type { EmailService } from "../email/service.server.ts";
import { deliverNotifications } from "../notifications/worker.server.ts";
export function deliverApprovalNotifications(
  connection: { client: Sql },
  email: EmailService,
  origin: string,
  limit = 20,
  onlyId: string | null = null,
) {
  return deliverNotifications(connection, email, origin, "approval", "", limit, onlyId);
}
