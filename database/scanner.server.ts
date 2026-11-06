import postgres from "postgres";
import { assertLocalDatabase, assertRuntimePrivileges, validateLocalUrl } from "./safety.ts";
// Dedicated worker credential only. Never imported by web handlers.
export async function connectLocalScanner(value = process.env["CAPE_SCANNER_DATABASE_URL"]) {
  const client = postgres(validateLocalUrl(value, "scanner"), {
    max: 2,
    connect_timeout: 5,
    idle_timeout: 10,
    connection: { TimeZone: "UTC", application_name: "cape-scan-worker" },
  });
  try {
    await assertLocalDatabase(client, "scanner");
    await assertRuntimePrivileges(client);
    return { client, close: () => client.end() };
  } catch (error) {
    await client.end();
    throw error;
  }
}
