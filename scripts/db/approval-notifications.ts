import { connectLocalDatabase } from "../../database/connection.server.ts";
import { configuredEmail } from "../../src/lib/email/service.server.ts";
import { deliverApprovalNotifications } from "../../src/lib/approvals/notifications.server.ts";
const origin = process.env["BETTER_AUTH_URL"];
if (!origin) throw new Error("Trusted application origin required");
const email = configuredEmail(origin);
const owner = await connectLocalDatabase();
try {
  console.log("Notifications delivered:", await deliverApprovalNotifications(owner, email, origin));
  const [row] = await owner.client`select count(*)::int as exhausted from app.approval_notifications
    where delivered_at is null and attempts>=8`;
  console.log("Notifications needing operator review:", row!["exhausted"]);
} finally {
  await owner.close();
}
