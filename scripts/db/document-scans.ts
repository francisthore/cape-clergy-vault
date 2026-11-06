import { operationalEvent } from "../../src/lib/operations/health.server.ts";
import { connectLocalScanner } from "../../database/scanner.server.ts";
import { configuredStorage } from "../../src/lib/documents/storage.server.ts";
import { configuredScanner } from "../../src/lib/scanning/scanner.server.ts";
import { runScanWorker } from "../../src/lib/scanning/worker.server.ts";
const worker = await connectLocalScanner();
try {
  operationalEvent(
    "scan.batch_completed",
    await runScanWorker(worker.client, configuredStorage(), configuredScanner(), 20),
  );
} catch {
  operationalEvent("scan.worker_failed", { failures: 1 });
  process.exitCode = 1;
} finally {
  await worker.close();
}
