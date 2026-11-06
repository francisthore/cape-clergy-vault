import postgres from "postgres";
import { assertLocalDatabase, assertRuntimePrivileges, validateLocalUrl } from "./safety.ts";
// Dedicated worker credential only. Never imported by web handlers.
export async function connectLocalNotifications(
  value = process.env["CAPE_NOTIFICATION_DATABASE_URL"],
) {
  const client = postgres(validateLocalUrl(value, "notifications"), {
    max: 2,
    connect_timeout: 5,
    idle_timeout: 10,
    connection: { TimeZone: "UTC", application_name: "cape-notification-worker" },
  });
  try {
    await assertLocalDatabase(client, "notifications");
    await assertRuntimePrivileges(client);
    return { client, close: () => client.end() };
  } catch (error) {
    await client.end();
    throw error;
  }
}
