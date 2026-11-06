import { statfs, lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { ScannerHealth } from "../scanning/scanner.server.ts";
export type ReadinessDependencies = {
  database: () => Promise<void>;
  scanner: () => Promise<ScannerHealth>;
  storage: () => Promise<{ freeBytes: number; freeInodes: number }>;
};
export async function readiness(deps: ReadinessDependencies) {
  const [db, scan, storage] = await Promise.allSettled([
    deps.database(),
    deps.scanner(),
    deps.storage(),
  ]);
  const essential =
    db.status === "fulfilled" &&
    storage.status === "fulfilled" &&
    storage.value.freeBytes >= 100 * 1024 * 1024 &&
    storage.value.freeInodes >= 1000;
  return !essential
    ? "unavailable"
    : scan.status === "fulfilled" && scan.value.ready
      ? "ready"
      : "degraded";
}
export const healthResponse = (state: "live" | "ready" | "degraded" | "unavailable") =>
  Response.json(
    { status: state },
    {
      status: state !== "unavailable" ? 200 : 503,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    },
  );
let cached: Promise<Response> | undefined,
  lastCheck = 0;
let connection:
  | Promise<
      Awaited<ReturnType<typeof import("../../../database/runtime.server.ts").connectLocalRuntime>>
    >
  | undefined;
export async function handleHealth(path: string) {
  if (path === "/health/live") return healthResponse("live");
  // Bound public probe cost and omit all component diagnostics.
  if (!cached || Date.now() - lastCheck > 15000) {
    lastCheck = Date.now();
    cached = (async () => {
      const { configuredScanner } = await import("../scanning/scanner.server.ts");
      const state = await readiness({
        database: async () => {
          const secret = process.env["BETTER_AUTH_SECRET"],
            origin = process.env["BETTER_AUTH_URL"];
          if (!secret || secret.length < 32 || !origin) throw Error("Configuration unavailable");
          new URL(origin);
          const { connectLocalRuntime } = await import("../../../database/runtime.server.ts");
          connection ??= connectLocalRuntime().catch((error) => {
            connection = undefined;
            throw error;
          });
          await (
            await connection
          ).client`select 1`;
        },
        scanner: () => configuredScanner().health(AbortSignal.timeout(10000)),
        storage: async () => {
          const root = process.env["CAPE_STORAGE_ROOT"] ?? ".local/storage";
          const stat = await lstat(root);
          if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            (stat.mode & 0o077) !== 0 ||
            stat.uid !== process.getuid?.()
          )
            throw Error("Storage unavailable");
          const stats = await statfs(root);
          return { freeBytes: stats.bavail * stats.bsize, freeInodes: stats.ffree };
        },
      });
      return healthResponse(state);
    })().catch(() => healthResponse("unavailable"));
  }
  return (await cached).clone();
}
export function operationalEvent(
  event:
    "scan.batch_completed" | "scan.worker_failed" | "operations.snapshot" | "retention.preview",
  counts: Record<string, number>,
  correlationId = randomUUID(),
) {
  // Whitelist categories and numeric values; never forward Error objects or provider payloads.
  console.log(
    JSON.stringify({
      event,
      correlationId,
      counts: Object.fromEntries(
        Object.entries(counts).filter(
          ([key, value]) => /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) && Number.isFinite(value),
        ),
      ),
    }),
  );
}
