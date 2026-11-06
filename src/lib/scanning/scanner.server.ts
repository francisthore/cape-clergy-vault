import { scannerProbePdf } from "./probe.server.ts";
import { lstat } from "node:fs/promises";
import { createConnection } from "node:net";
import { isAbsolute } from "node:path";
export const MAX_SCAN_BYTES = 20 * 1024 * 1024;
export type ScanErrorCategory =
  | "unavailable"
  | "timeout"
  | "disconnected"
  | "invalid_response"
  | "size_limit"
  | "definitions_missing"
  | "definitions_stale"
  | "integrity_mismatch"
  | "object_missing"
  | "storage_error"
  | "scanner_error"
  | "ineligible";
export type ScannerHealth = {
  ready: boolean;
  reachable: boolean;
  engineAvailable: boolean;
  signaturesAvailable: boolean;
  fresh: boolean;
  testObjectPassed: boolean;
  engine?: string;
  definitionsVersion?: string;
  definitionsAt?: Date;
  category?: ScanErrorCategory;
};
export type ScanResult = {
  verdict: "clean" | "infected" | "error" | "unavailable";
  category?: ScanErrorCategory;
  engine?: string;
  definitionsVersion?: string;
  definitionsAt?: Date;
};
export interface MalwareScanner {
  readonly name: string;
  health(signal?: AbortSignal): Promise<ScannerHealth>;
  scan(bytes: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<ScanResult>;
}
class ScannerFailure extends Error {
  readonly category: ScanErrorCategory;
  constructor(category: ScanErrorCategory) {
    super(category);
    this.category = category;
  }
}
export function parseVersion(reply: string, maxAgeHours: number, now = Date.now()) {
  const m =
    /^ClamAV ([0-9][\w.+-]{0,63})\/(\d{1,12})\/([A-Za-z]{3} [A-Za-z]{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})$/.exec(
      reply,
    );
  if (!m || Number(m[2]) < 1) throw new ScannerFailure("definitions_missing");
  // clamd is required to run with TZ=UTC; never use filesystem mtime as definition age.
  const date = new Date(m[3] + " UTC");
  if (!Number.isFinite(date.getTime())) throw new ScannerFailure("definitions_missing");
  if (date.getTime() < now - maxAgeHours * 3600000 || date.getTime() > now + 300000)
    throw new ScannerFailure("definitions_stale");
  return { engine: "ClamAV " + m[1], definitionsVersion: m[2]!, definitionsAt: date };
}
export function parseVerdict(reply: string): ScanResult {
  if (reply === "stream: OK") return { verdict: "clean" };
  if (/(?:size limit|Heuristics\.Limits\.Exceeded)/i.test(reply))
    return { verdict: "error", category: "size_limit" };
  if (/^stream: [A-Za-z0-9_.:+() -]{1,180} FOUND$/.test(reply)) return { verdict: "infected" };
  if (/ ERROR$/.test(reply)) return { verdict: "error", category: "scanner_error" };
  return { verdict: "error", category: "invalid_response" };
}
export class ClamAvScanner implements MalwareScanner {
  readonly name = "ClamAV";
  private active = 0;
  private options: {
    socketPath: string;
    maxDefinitionAgeHours?: number;
    connectTimeoutMs?: number;
    scanTimeoutMs?: number;
    totalTimeoutMs?: number;
    concurrency?: number;
  };
  constructor(options: ClamAvScanner["options"]) {
    this.options = options;
    if (!isAbsolute(options.socketPath) || options.socketPath.includes("\0"))
      throw Error("Absolute protected local scanner socket required");
    for (const [value, min, max] of [
      [options.maxDefinitionAgeHours ?? 48, 1, 72],
      [options.connectTimeoutMs ?? 2000, 10, 10000],
      [options.scanTimeoutMs ?? 30000, 10, 60000],
      [options.totalTimeoutMs ?? 120000, 100, 180000],
      [options.concurrency ?? 2, 1, 4],
    ])
      if (!Number.isInteger(value) || value! < min! || value! > max!)
        throw Error("Invalid scanner limits");
  }
  private async exchange(
    command: "PING" | "VERSIONCOMMANDS" | "VERSION" | "INSTREAM",
    bytes: AsyncIterable<Uint8Array> | undefined,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    const socketStat = await lstat(this.options.socketPath);
    if (!socketStat.isSocket() || socketStat.isSymbolicLink() || (socketStat.mode & 0o007) !== 0)
      throw new ScannerFailure("unavailable");
    const socket = createConnection({ path: this.options.socketPath });
    let connected = false;
    const connectionTimer = setTimeout(
      () => socket.destroy(new ScannerFailure("timeout")),
      this.options.connectTimeoutMs ?? 2000,
    );
    const operationTimer = setTimeout(
      () => socket.destroy(new ScannerFailure("timeout")),
      this.options.scanTimeoutMs ?? 30000,
    );
    const abort = () => socket.destroy(new ScannerFailure("timeout"));
    signal.addEventListener("abort", abort, { once: true });
    let reply = Buffer.alloc(0);
    const response = new Promise<string>((resolve, reject) => {
      socket.on("data", (data: Buffer) => {
        reply = Buffer.concat([reply, data]);
        if (reply.length > 4096) socket.destroy(new ScannerFailure("invalid_response"));
      });
      socket.once("error", (error) =>
        reject(
          error instanceof ScannerFailure
            ? error
            : new ScannerFailure(connected ? "disconnected" : "unavailable"),
        ),
      );
      socket.once("end", () => {
        if (reply.length < 1 || reply[reply.length - 1] !== 0 || reply.subarray(0, -1).includes(0))
          reject(new ScannerFailure("invalid_response"));
        else resolve(reply.subarray(0, -1).toString("utf8"));
      });
      socket.once("close", () => reject(new ScannerFailure("disconnected")));
    });
    // Observe errors immediately, including while storage reads are pending.
    void response.catch(() => undefined);
    const write = (data: Uint8Array) =>
      new Promise<void>((resolve, reject) =>
        socket.write(data, (error) =>
          error ? reject(new ScannerFailure("disconnected")) : resolve(),
        ),
      );
    try {
      const send = (async () => {
        await new Promise<void>((resolve, reject) => {
          socket.once("connect", () => {
            connected = true;
            clearTimeout(connectionTimer);
            resolve();
          });
          socket.once("error", reject);
        });
        await write(Buffer.from("z" + command + "\0"));
        if (bytes) {
          let size = 0;
          for await (const bytesChunk of bytes) {
            signal.throwIfAborted();
            size += bytesChunk.byteLength;
            if (size > MAX_SCAN_BYTES) throw new ScannerFailure("size_limit");
            for (let offset = 0; offset < bytesChunk.length; offset += 65536) {
              const chunk = bytesChunk.subarray(offset, offset + 65536),
                header = Buffer.alloc(4);
              header.writeUInt32BE(chunk.length);
              await write(header);
              await write(chunk);
            }
          }
          await write(Buffer.alloc(4));
        }
      })();
      try {
        const [, result] = await Promise.all([send, response]);
        return result;
      } catch (error) {
        // clamd may return a size-limit error and close before writes finish.
        // Preserve a complete error response, but never accept early OK/FOUND as a full scan.
        if (error instanceof ScannerFailure && error.category === "size_limit") throw error;
        try {
          const reply = await response;
          if (command === "INSTREAM" && parseVerdict(reply).verdict === "error") return reply;
        } catch {
          /* Transport failure remains unavailable, never clean. */
        }
        throw error;
      }
    } finally {
      clearTimeout(connectionTimer);
      clearTimeout(operationTimer);
      signal.removeEventListener("abort", abort);
      socket.destroy();
    }
  }
  private signal(external?: AbortSignal) {
    return AbortSignal.any([
      AbortSignal.timeout(this.options.totalTimeoutMs ?? 120000),
      ...(external ? [external] : []),
    ]);
  }
  async health(external?: AbortSignal): Promise<ScannerHealth> {
    const signal = this.signal(external);
    const status: ScannerHealth = {
      ready: false,
      reachable: false,
      engineAvailable: false,
      signaturesAvailable: false,
      fresh: false,
      testObjectPassed: false,
    };
    try {
      if ((await this.exchange("PING", undefined, signal)) !== "PONG")
        throw new ScannerFailure("invalid_response");
      status.reachable = true;
      const commands = await this.exchange("VERSIONCOMMANDS", undefined, signal);
      if (!commands.includes("COMMANDS:") || !commands.split(/\s+/).includes("INSTREAM"))
        throw new ScannerFailure("invalid_response");
      status.engineAvailable = true;
      const versionReply = await this.exchange("VERSION", undefined, signal);
      Object.assign(status, parseVersion(versionReply, Infinity));
      status.signaturesAvailable = true;
      parseVersion(versionReply, this.options.maxDefinitionAgeHours ?? 48);
      status.fresh = true;
      const test = async function* () {
        yield scannerProbePdf();
      };
      const verdict = parseVerdict(await this.exchange("INSTREAM", test(), signal));
      if (verdict.verdict !== "clean")
        throw new ScannerFailure(verdict.category ?? "scanner_error");
      status.testObjectPassed = true;
      status.ready = true;
    } catch (error) {
      status.category =
        error instanceof ScannerFailure
          ? error.category
          : signal.aborted
            ? "timeout"
            : "unavailable";
    }
    return status;
  }
  async scan(bytes: AsyncIterable<Uint8Array>, external?: AbortSignal): Promise<ScanResult> {
    if (this.active >= (this.options.concurrency ?? 2))
      return { verdict: "unavailable", category: "unavailable" };
    this.active++;
    const signal = this.signal(external);
    try {
      const health = await this.health(signal);
      if (!health.ready)
        return { verdict: "unavailable", category: health.category ?? "unavailable" };
      const verdict = parseVerdict(await this.exchange("INSTREAM", bytes, signal));
      if (verdict.verdict !== "clean" && verdict.verdict !== "infected") return verdict;
      const after = parseVersion(
        await this.exchange("VERSION", undefined, signal),
        this.options.maxDefinitionAgeHours ?? 48,
      );
      if (after.engine !== health.engine || after.definitionsVersion !== health.definitionsVersion)
        return { verdict: "error", category: "scanner_error" };
      return { ...verdict, ...after };
    } catch (error) {
      return {
        verdict: "error",
        category:
          error instanceof ScannerFailure
            ? error.category
            : signal.aborted
              ? "timeout"
              : "scanner_error",
      };
    } finally {
      this.active--;
    }
  }
}
export function configuredScanner(): MalwareScanner {
  if ((process.env["CAPE_SCANNER"] ?? "clamav") !== "clamav")
    throw Error("Only ClamAV may be configured; test doubles require explicit test injection");
  return new ClamAvScanner({
    socketPath: process.env["CAPE_CLAMD_SOCKET"] ?? "/run/clamav/clamd.sock",
    maxDefinitionAgeHours: Number(process.env["CAPE_SCAN_MAX_DEFINITION_AGE_HOURS"] ?? 48),
  });
}
