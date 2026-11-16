import { spawnSync } from "node:child_process";
import { connectLocalRuntime } from "../database/runtime.server.ts";
import { connectLocalScanner } from "../database/scanner.server.ts";
import { connectLocalNotifications } from "../database/notifications.server.ts";
import { acquireWorkerLock } from "./worker-lock.ts";
for (const connect of [connectLocalRuntime, connectLocalScanner, connectLocalNotifications]) {
  const connection = await connect();
  try {
    // A pre-existing manual batch is a conflict, not a reason to start a second loop.
    if (connect === connectLocalScanner || connect === connectLocalNotifications) {
      for (const kind of connect === connectLocalScanner
        ? (["scanner"] as const)
        : (["approval", "reviewer"] as const)) {
        if (spawnSync("flock", ["-n", `.local/worker-${kind}.lock`, "true"]).status !== 0)
          throw Error(`Another ${kind} worker loop is already running.`);
        const release = await acquireWorkerLock(connection.client, kind);
        await release();
      }
    }
    if (connect === connectLocalRuntime)
      await connection.client`select app.owner_document_verification(null::uuid), app.has_operational('review_coordinator')`;
  } finally {
    await connection.close();
  }
}
console.log("Restricted database identities and worker availability verified.");
