// Only these service factories select production. Existing local/operator guards stay unchanged.
import { connectLocalRuntime } from "./runtime.server.ts";
import { connectLocalScanner } from "./scanner.server.ts";
import { connectLocalNotifications } from "./notifications.server.ts";
import {
  assertPilotContract,
  connectProductionDatabase,
  connectProductionRuntime,
} from "./production.server.ts";
function production() {
  const mode = process.env["CAPE_DATABASE_MODE"] ?? "local";
  if (!["local", "production"].includes(mode))
    throw Error("Explicit database environment required");
  return mode === "production";
}
let runtime: Promise<Awaited<ReturnType<typeof connectLocalRuntime>>> | undefined;
export function connectRuntime() {
  runtime ??= (async () => {
    const isProduction = production();
    const connection = isProduction
      ? await connectProductionRuntime()
      : await connectLocalRuntime();
    try {
      if (!isProduction) await assertPilotContract(connection.client);
      return connection;
    } catch (error) {
      await connection.close();
      throw error;
    }
  })().catch((error) => {
    runtime = undefined;
    throw error;
  });
  return runtime;
}
export async function connectScanner() {
  if (production()) return connectProductionDatabase("scanner");
  const connection = await connectLocalScanner();
  try {
    await assertPilotContract(connection.client);
    return connection;
  } catch (error) {
    await connection.close();
    throw error;
  }
}
export async function connectNotifications() {
  if (production()) return connectProductionDatabase("notifications");
  const connection = await connectLocalNotifications();
  try {
    await assertPilotContract(connection.client);
    return connection;
  } catch (error) {
    await connection.close();
    throw error;
  }
}
