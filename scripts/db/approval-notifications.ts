import { connectLocalNotifications } from "../../database/notifications.server.ts";
import { configuredEmail } from "../../src/lib/email/service.server.ts";
import { deliverApprovalNotifications } from "../../src/lib/approvals/notifications.server.ts";
const origin = process.env["BETTER_AUTH_URL"];
if (!origin) throw new Error("Trusted application origin required");
const worker = await connectLocalNotifications();
const email = configuredEmail(origin, process.env, worker.client);
try {
  console.log(
    "Notifications delivered:",
    await deliverApprovalNotifications(worker, email, origin),
  );
} finally {
  await worker.close();
}
