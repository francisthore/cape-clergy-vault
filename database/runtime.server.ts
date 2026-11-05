import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { assertLocalDatabase, assertRuntimePrivileges, validateLocalUrl } from "./safety.ts";
import * as schema from "./schema/index.ts";

// Local-only until production infrastructure receives a separately reviewed boundary.
export async function connectLocalRuntime(value = process.env["CAPE_RUNTIME_DATABASE_URL"]) {
  const client = postgres(validateLocalUrl(value, true), {
    max: 2,
    connect_timeout: 5,
    idle_timeout: 10,
  });
  try {
    await assertLocalDatabase(client, true);
    await assertRuntimePrivileges(client);
    return {
      runtimeOnly: true as const,
      client,
      db: drizzle(client, { schema }),
      close: () => client.end(),
    };
  } catch (error) {
    await client.end();
    throw error;
  }
}
export type RuntimeConnection = Awaited<ReturnType<typeof connectLocalRuntime>>;
