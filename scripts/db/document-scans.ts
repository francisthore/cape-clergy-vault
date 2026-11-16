import { acquireWorkerLock } from "../worker-lock.ts";
import { operationalEvent } from "../../src/lib/operations/health.server.ts";
import { connectLocalScanner } from "../../database/scanner.server.ts";
import { configuredStorage } from "../../src/lib/documents/storage.server.ts";
import { configuredScanner } from "../../src/lib/scanning/scanner.server.ts";
import { runScanWorker } from "../../src/lib/scanning/worker.server.ts";
const worker = await connectLocalScanner();
let release: (() => Promise<void>) | undefined;
try {
  release = await acquireWorkerLock(worker.client, "scanner");
  operationalEvent(
    "scan.batch_completed",
    await runScanWorker(worker.client, configuredStorage(), configuredScanner(), 20, null, () => {
      process.exitCode = 1;
    }),
  );
} catch {
  operationalEvent("scan.worker_failed", { failures: 1 });
  process.exitCode = 1;
} finally {
  await release?.();
  await worker.close();
}
