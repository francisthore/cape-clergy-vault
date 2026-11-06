import { connectLocalNotifications } from "../../database/notifications.server.ts";
import { configuredEmail } from "../../src/lib/email/service.server.ts";
import { deliverReviewerNotifications } from "../../src/lib/reviews/notifications.server.ts";
const origin = process.env["BETTER_AUTH_URL"],
  secret = process.env["BETTER_AUTH_SECRET"];
if (!origin || !secret)
  throw Error("Trusted application origin and protected auth secret required");
const worker = await connectLocalNotifications();
try {
  console.log(
    "Reviewer notifications delivered:",
    await deliverReviewerNotifications(
      worker,
      configuredEmail(origin, process.env, worker.client),
      origin,
      secret,
    ),
  );
} finally {
  await worker.close();
}
