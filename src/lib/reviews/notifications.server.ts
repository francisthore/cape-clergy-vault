import type { Sql } from "postgres";
import type { EmailService } from "../email/service.server.ts";
import { deliverNotifications } from "../notifications/worker.server.ts";
export function deliverReviewerNotifications(
  connection: { client: Sql },
  email: EmailService,
  origin: string,
  secret: string,
  limit = 20,
  onlyId: string | null = null,
) {
  return deliverNotifications(connection, email, origin, "reviewer", secret, limit, onlyId);
}
