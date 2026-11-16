import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import type { StorageProvider } from "../documents/storage.server.ts";
import { MAX_PDF_BYTES } from "../documents/validation.ts";
import { BouncerFailure, type BouncerScanner } from "./bouncer.server.ts";
import type { ScanClaim } from "./worker.server.ts";
class CheckpointFailure extends Error {}
async function checkpoint<T>(query: PromiseLike<T>): Promise<T> {
  try {
    return await query;
  } catch {
    throw new CheckpointFailure("Uncertain scanner database checkpoint");
  }
}
type Claim = ScanClaim & { externalScanId: string | null; providerStatus: string };

async function* storedBytes(storage: StorageProvider, c: Claim, signal: AbortSignal) {
  const object = await storage.open(c.storageKey);
  let size = 0;
  try {
    if (object.byteSize !== c.byteSize || object.byteSize > MAX_PDF_BYTES)
      throw Error("integrity_mismatch");
    while (true) {
      signal.throwIfAborted();
      const bytes = await object.read();
      if (!bytes) break;
      size += bytes.length;
      if (size > c.byteSize || size > MAX_PDF_BYTES) throw Error("integrity_mismatch");
      yield bytes;
    }
    if (size !== c.byteSize) throw Error("integrity_mismatch");
  } finally {
    await object.close();
  }
}
async function checksum(storage: StorageProvider, c: Claim, signal: AbortSignal) {
  const hash = createHash("sha256");
  for await (const bytes of storedBytes(storage, c, signal)) hash.update(bytes);
  const value = hash.digest("hex");
  if (value !== c.sha256) throw Error("integrity_mismatch");
  return value;
}
export async function runBouncerWorker(
  db: Sql,
  storage: StorageProvider,
  scanner: BouncerScanner,
  limit: number,
  onlyId: string | null,
  onFailure: () => void = () => {},
) {
  let claimed = 0,
    completed = 0;
  for (let i = 0; i < limit; i++) {
    const [row] = await db`select app.claim_bouncer_scan(${onlyId}::uuid) as claim`;
    const c = row?.["claim"] as Claim | null;
    if (!c) break;
    claimed++;
    const signal = AbortSignal.timeout(180000);
    let result = "unavailable",
      localHash: string | null = null,
      reportedHash: string | null = null,
      reportedSize: number | null = null,
      polled = false;
    try {
      if (!c.externalScanId) {
        if (c.providerStatus === "submitting") result = "ambiguous";
        else {
          // Verify bytes and quota BEFORE committing the ambiguous-submission marker.
          localHash = await checksum(storage, c, signal);
          scanner.canSubmit(c.byteSize);
          const usage = await scanner.usage(signal);
          const [reserved] = await checkpoint(
            db`select app.reserve_bouncer_scan(${c.documentId},${c.lease},${usage.used},${usage.limit},${usage.period}) as ok`,
          );
          if (!reserved?.["ok"]) result = "quota";
          else {
            await scanner.submit(
              storedBytes(storage, c, signal),
              c.byteSize,
              async (id) => {
                const [saved] = await checkpoint(
                  db`select app.accept_bouncer_scan(${c.documentId},${c.lease},${id}) as ok`,
                );
                if (!saved?.["ok"]) throw new CheckpointFailure("Scan lease lost");
                c.externalScanId = id;
              },
              signal,
            );
            result = "submitted";
          }
        }
      } else {
        polled = true;
        const response = await scanner.poll(c.externalScanId, signal);
        result = response.status === "completed" ? response.verdict! : response.status;
        reportedHash = response.sha256 ?? null;
        reportedSize = response.byteSize ?? null;
        if (["clean", "malicious", "suspicious"].includes(result)) {
          localHash = await checksum(storage, c, signal);
          if (reportedHash !== c.sha256 || reportedSize !== c.byteSize)
            result = "integrity_mismatch";
        }
      }
    } catch (error) {
      if (error instanceof CheckpointFailure) throw error;
      result =
        error instanceof BouncerFailure
          ? error.category
          : signal.aborted
            ? "timeout"
            : (error as NodeJS.ErrnoException).code === "ENOENT"
              ? "object_missing"
              : error instanceof Error && error.message === "integrity_mismatch"
                ? "integrity_mismatch"
                : "unavailable";
    }
    if (!["submitted", "pending", "scanning", "clean", "malicious"].includes(result)) onFailure();
    // Never retry an unknown database commit in-process. The durable lease/ID resolves recovery.
    const [done] =
      await db`select app.finish_bouncer_scan(${c.documentId},${c.lease},${c.externalScanId},${result},${localHash},${reportedHash},${reportedSize},${polled}) as ok`;
    if (done?.["ok"]) completed++;
  }
  return { claimed, completed };
}
