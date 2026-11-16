import { acquireWorkerLock } from "../worker-lock.ts";
import { connectLocalNotifications } from "../../database/notifications.server.ts";
import { configuredEmail } from "../../src/lib/email/service.server.ts";
import { deliverApprovalNotifications } from "../../src/lib/approvals/notifications.server.ts";
const origin = process.env["BETTER_AUTH_URL"];
if (!origin) throw new Error("Trusted application origin required");
const worker = await connectLocalNotifications();
const email = configuredEmail(origin, process.env, worker.client);
let release: (() => Promise<void>) | undefined;
try {
  release = await acquireWorkerLock(worker.client, "approval");
  console.log(
    "Notifications delivered:",
    await deliverApprovalNotifications(worker, email, origin, 20, null, () => {
      process.exitCode = 1;
    }),
  );
} finally {
  await release?.();
  await worker.close();
}
