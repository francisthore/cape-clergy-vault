import type { Sql } from "postgres";
// Session-scoped lock on a reserved connection: manual CLIs and supervised batches
// share it. It changes neither queue leases nor database permissions.
export async function acquireWorkerLock(db: Sql, kind: "scanner" | "approval" | "reviewer") {
  const connection = await db.reserve();
  const key = { scanner: 1, approval: 2, reviewer: 3 }[kind];
  try {
    const [row] = await connection`select pg_try_advisory_lock(421, ${key}) as locked`;
    if (!row?.["locked"]) throw Error(`Another ${kind} worker is already running.`);
  } catch (error) {
    connection.release();
    throw error;
  }
  return async () => {
    try {
      await connection`select pg_advisory_unlock(421, ${key})`;
    } finally {
      connection.release();
    }
  };
}
