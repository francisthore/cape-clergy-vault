import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import type { StorageProvider } from "../documents/storage.server.ts";
import { MAX_SCAN_BYTES, type MalwareScanner, type ScanResult } from "./scanner.server.ts";
export type ScanClaim = {
  documentId: string;
  storageKey: string;
  sha256: string;
  byteSize: number;
  lease: string;
  attempt: number;
  correlationId: string;
};
export async function runScanWorker(
  db: Sql,
  storage: StorageProvider,
  scanner: MalwareScanner,
  limit = 20,
  onlyId: string | null = null,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw Error("Bounded scan batch required");
  if (process.env["NODE_ENV"] === "production" && scanner.name !== "ClamAV")
    throw Error("Production requires ClamAV");
  let claimed = 0,
    completed = 0;
  for (let i = 0; i < limit; i++) {
    const [row] = await db`select app.claim_document_scan(${onlyId}::uuid) as claim`;
    const claim = row?.["claim"] as ScanClaim | null;
    if (!claim) break;
    claimed++;
    const signal = AbortSignal.timeout(180000);
    let result: ScanResult = { verdict: "error", category: "storage_error" },
      checksum: string | null = null;
    let object: Awaited<ReturnType<StorageProvider["open"]>> | undefined;
    try {
      object = await storage.open(claim.storageKey);
      if (object.byteSize !== claim.byteSize || object.byteSize > MAX_SCAN_BYTES)
        result = { verdict: "error", category: "integrity_mismatch" };
      else {
        const hash = createHash("sha256");
        let size = 0,
          ended = false;
        const opened = object;
        async function* bytes() {
          while (true) {
            signal.throwIfAborted();
            const chunk = await opened.read();
            if (!chunk) {
              ended = true;
              break;
            }
            size += chunk.byteLength;
            if (size > MAX_SCAN_BYTES || size > claim!.byteSize) throw Error("Object changed");
            hash.update(chunk);
            yield chunk;
          }
        }
        result = await scanner.scan(bytes(), signal);
        if (ended && size === claim.byteSize) checksum = hash.digest("hex");
        if (
          (result.verdict === "clean" || result.verdict === "infected") &&
          checksum !== claim.sha256
        )
          result = { verdict: "error", category: "integrity_mismatch" };
        // Reopen and hash again before promotion to detect replacement/modification during scanning.
        // Files remain immutable to application writes; trusted OS tampering is outside RLS.
        if (result.verdict === "clean") {
          const verify = await storage.open(claim.storageKey);
          const check = createHash("sha256");
          let count = 0;
          try {
            while (true) {
              signal.throwIfAborted();
              const chunk = await verify.read();
              if (!chunk) break;
              count += chunk.length;
              if (count > MAX_SCAN_BYTES) break;
              check.update(chunk);
            }
          } finally {
            await verify.close();
          }
          if (count !== claim.byteSize || check.digest("hex") !== checksum)
            result = { verdict: "error", category: "integrity_mismatch" };
        }
      }
    } catch (error) {
      result = {
        verdict: "error",
        category: signal.aborted
          ? "timeout"
          : (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "object_missing"
            : "storage_error",
      };
    } finally {
      await object?.close();
    }
    // A lost connection/uncertain commit leaves the lease recoverable; never fabricate success.
    const [finished] =
      await db`select app.finish_document_scan(${claim.documentId},${claim.lease},${result.verdict},${checksum},${result.engine ?? null},${result.definitionsVersion ?? null},${result.definitionsAt ?? null},${result.category ?? null}) as finished`;
    if (finished?.["finished"]) completed++;
  }
  return { claimed, completed };
}
