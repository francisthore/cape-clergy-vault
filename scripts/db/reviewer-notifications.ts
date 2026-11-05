import { connectLocalDatabase } from "../../database/connection.server.ts";
import { configuredEmail } from "../../src/lib/email/service.server.ts";
import { deliverReviewerNotifications } from "../../src/lib/reviews/notifications.server.ts";
const origin = process.env["BETTER_AUTH_URL"],
  secret = process.env["BETTER_AUTH_SECRET"];
if (!origin || !secret)
  throw Error("Trusted application origin and protected auth secret required");
const owner = await connectLocalDatabase();
try {
  console.log(
    "Reviewer notifications delivered:",
    await deliverReviewerNotifications(
      owner,
      configuredEmail(origin, process.env, owner.client),
      origin,
      secret,
    ),
  );
  const [r] =
    await owner.client`select count(*)::int as exhausted from app.reviewer_notifications where delivered_at is null and cancelled_at is null and attempts>=8`;
  console.log("Reviewer notifications needing operator review:", r!["exhausted"]);
} finally {
  await owner.close();
}
