import { acquireWorkerLock } from "../worker-lock.ts";
import { connectNotifications } from "../../database/service-connections.server.ts";
import { configuredEmail } from "../../src/lib/email/service.server.ts";
import { deliverReviewerNotifications } from "../../src/lib/reviews/notifications.server.ts";
const origin = process.env["BETTER_AUTH_URL"],
  secret = process.env["BETTER_AUTH_SECRET"];
if (!origin || !secret)
  throw Error("Trusted application origin and protected auth secret required");
const worker = await connectNotifications();
let release: (() => Promise<void>) | undefined;
try {
  release = await acquireWorkerLock(worker.client, "reviewer");
  console.log(
    "Reviewer notifications delivered:",
    await deliverReviewerNotifications(
      worker,
      configuredEmail(origin, process.env, worker.client),
      origin,
      secret,
      20,
      null,
      () => {
        process.exitCode = 1;
      },
    ),
  );
} finally {
  await release?.();
  await worker.close();
}
