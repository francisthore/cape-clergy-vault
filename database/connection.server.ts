import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.ts";
import { assertLocalDatabase, validateLocalUrl } from "./safety.ts";

// Explicit, lazy factory: importing the schema or building the app never connects.
// Phase 2A is tooling-only; no application route imports this module.
export async function connectLocalDatabase(value = process.env["CAPE_DATABASE_URL"]) {
  const client = postgres(validateLocalUrl(value), {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 10,
    connection: { application_name: "cape-clergy-vault-phase2a" },
  });
  try {
    await assertLocalDatabase(client);
    return { db: drizzle(client, { schema }), client, close: () => client.end() };
  } catch (error) {
    await client.end();
    throw error;
  }
}
export type ApplicationDatabase = Awaited<ReturnType<typeof connectLocalDatabase>>["db"];
