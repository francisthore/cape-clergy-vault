import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { MAX_PDF_BYTES } from "../documents/validation.ts";
import type { MalwareScanner, ScannerHealth, ScanResult } from "./scanner.server.ts";

const ORIGIN = "https://api.usebouncer.dev";
export const BOUNCER_V1_MAX_BYTES = 4 * 1024 * 1024; // Leave room below the documented ~4.5 MB request cap.
export type BouncerCategory =
  "quota" | "unavailable" | "timeout" | "invalid_response" | "unsafe_destination";
export class BouncerFailure extends Error {
  readonly category: BouncerCategory;
  constructor(category: BouncerCategory) {
    super(category);
    this.category = category;
  }
}
export type BouncerResult = {
  scanId: string;
  status: "pending" | "scanning" | "completed" | "failed";
  verdict?: "clean" | "malicious" | "suspicious";
  sha256?: string;
  byteSize?: number;
};
export type BouncerUsage = { used: number; limit: number; period: string; resetsAt: string };
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new BouncerFailure("invalid_response");
  return v as Record<string, unknown>;
};
export function validateScanId(value: unknown): string {
  if (typeof value !== "string" || !/^scan_[A-Za-z0-9_-]{1,120}$/.test(value))
    throw new BouncerFailure("invalid_response");
  return value;
}
export function validateUploadHost(host: string) {
  // Exact operator-pinned AWS bucket only; no arbitrary URL, port, suffix match or IP literal.
  if (!/^bouncer-[a-z0-9-]+\.s3(?:\.ap-south-1)?\.amazonaws\.com$/.test(host))
    throw new BouncerFailure("unsafe_destination");
  return host;
}
export function validateUploadTarget(value: unknown, host: string, scanId: string) {
  validateUploadHost(host);
  const upload = record(value);
  if (typeof upload["url"] !== "string") throw new BouncerFailure("unsafe_destination");
  let url: URL;
  try {
    url = new URL(upload["url"]);
  } catch {
    throw new BouncerFailure("unsafe_destination");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== host ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new BouncerFailure("unsafe_destination");
  const fields = record(upload["fields"]);
  if (Object.keys(fields).length > 32 || JSON.stringify(fields).length > 65536)
    throw new BouncerFailure("invalid_response");
  for (const [key, val] of Object.entries(fields)) {
    if (
      !/^[A-Za-z0-9_-]{1,80}$/.test(key) ||
      key.toLowerCase() === "file" ||
      typeof val !== "string" ||
      val.length > 16384 ||
      /[\r\n]/.test(val)
    )
      throw new BouncerFailure("invalid_response");
  }
  if (fields["key"] !== `uploads/${scanId}/document.pdf`)
    throw new BouncerFailure("unsafe_destination");
  return { url: url.href, fields: fields as Record<string, string> };
}

export class BouncerScanner implements MalwareScanner {
  readonly name = "Bouncer";
  private options: { apiKey: string; uploadHost: string; fetch?: typeof fetch; timeoutMs?: number };
  constructor(options: BouncerScanner["options"]) {
    if (!options.apiKey || /[\r\n]/.test(options.apiKey))
      throw Error("Bouncer worker API key required");
    if (options.uploadHost) validateUploadHost(options.uploadHost);
    this.options = options;
  }
  private async request(path: string, init: RequestInit, external?: AbortSignal) {
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.options.timeoutMs ?? 60000),
      ...(external ? [external] : []),
    ]);
    try {
      return await (this.options.fetch ?? fetch)(path, { ...init, redirect: "error", signal });
    } catch {
      throw new BouncerFailure(signal.aborted ? "timeout" : "unavailable");
    }
  }
  private async api(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    const res = await this.request(
      ORIGIN + path,
      {
        ...init,
        headers: { ...init.headers, "X-API-Key": this.options.apiKey, Accept: "application/json" },
      },
      signal,
    );
    if (!res.ok) {
      await res.body?.cancel();
      throw new BouncerFailure(res.status === 429 ? "quota" : "unavailable");
    }
    // Do not retain threats, original names or raw provider diagnostics.
    const reader = res.body?.getReader();
    if (!reader) throw new BouncerFailure("invalid_response");
    let body = "",
      size = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 65536) throw new BouncerFailure("invalid_response");
        body += decoder.decode(next.value, { stream: true });
      }
      body += decoder.decode();
      const payload = record(JSON.parse(body));
      if (payload["status"] !== "success") throw new BouncerFailure("invalid_response");
      return record(payload["data"]);
    } catch (error) {
      throw error instanceof BouncerFailure ? error : new BouncerFailure("invalid_response");
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  async usage(signal?: AbortSignal): Promise<BouncerUsage> {
    const d = await this.api("/v1/scan/usage", {}, signal);
    const used = d["scans_used"],
      limit = d["scans_limit"],
      period = d["period"],
      reset = d["resets_at"];
    const now = new Date();
    const nextMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    ).toISOString();
    if (
      d["tier"] !== "free" ||
      !Number.isSafeInteger(used) ||
      Number(used) < 0 ||
      !Number.isSafeInteger(limit) ||
      Number(limit) < 1 ||
      Number(limit) > 500 ||
      period !== now.toISOString().slice(0, 7) ||
      typeof reset !== "string" ||
      !Number.isFinite(Date.parse(reset)) ||
      new Date(reset).toISOString() !== nextMonth
    )
      throw new BouncerFailure("invalid_response");
    return { used: Number(used), limit: Number(limit), period: String(period), resetsAt: reset };
  }
  canSubmit(size: number) {
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_PDF_BYTES)
      throw new BouncerFailure("invalid_response");
    if (size > BOUNCER_V1_MAX_BYTES) validateUploadHost(this.options.uploadHost);
  }
  private async multipart(
    url: string,
    fields: Record<string, string>,
    bytes: AsyncIterable<Uint8Array>,
    size: number,
    authenticated: boolean,
    signal?: AbortSignal,
  ) {
    const boundary = "cape-" + randomUUID();
    const prefix =
      Object.entries(fields)
        .map(
          ([key, value]) =>
            `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
        )
        .join("") +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="document.pdf"\r\nContent-Type: application/pdf\r\n\r\n`;
    const suffix = `\r\n--${boundary}--\r\n`;
    async function* body() {
      yield Buffer.from(prefix);
      let count = 0;
      for await (const chunk of bytes) {
        signal?.throwIfAborted();
        count += chunk.length;
        if (count > size || count > MAX_PDF_BYTES) throw new BouncerFailure("invalid_response");
        yield chunk;
      }
      if (count !== size) throw new BouncerFailure("invalid_response");
      yield Buffer.from(suffix);
    }
    const init = {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(Buffer.byteLength(prefix) + size + Buffer.byteLength(suffix)),
      },
      body: Readable.from(body()) as unknown as BodyInit,
      duplex: "half",
    };
    if (authenticated) return this.api("/v1/scan", init, signal);
    const res = await this.request(url, init, signal); // Deliberately no API key on S3 requests.
    await res.body?.cancel();
    if (res.status !== 204) throw new BouncerFailure("unavailable");
    return null;
  }
  async submit(
    bytes: AsyncIterable<Uint8Array>,
    size: number,
    accepted: (id: string) => Promise<void>,
    signal?: AbortSignal,
  ) {
    this.canSubmit(size);
    if (size <= BOUNCER_V1_MAX_BYTES) {
      const d = (await this.multipart(ORIGIN + "/v1/scan", {}, bytes, size, true, signal))!;
      const id = validateScanId(d["scan_id"]);
      // Save the accepted ID even if other response fields are malformed. Never repeat this POST.
      await accepted(id);
      if (d["status"] !== "pending") throw new BouncerFailure("invalid_response");
    } else {
      const d = await this.api(
        "/v2/scan",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_name: "document.pdf", mime_type: "application/pdf" }),
        },
        signal,
      );
      const id = validateScanId(d["scan_id"]);
      await accepted(id); // Commit before S3 I/O; credentials remain in this stack only.
      if (
        d["status"] !== "pending" ||
        !Number.isSafeInteger(d["max_file_size"]) ||
        Number(d["max_file_size"]) < size
      )
        throw new BouncerFailure("invalid_response");
      const target = validateUploadTarget(d["upload"], this.options.uploadHost, id);
      await this.multipart(target.url, target.fields, bytes, size, false, signal);
    }
  }
  async poll(id: string, signal?: AbortSignal): Promise<BouncerResult> {
    validateScanId(id);
    const d = await this.api("/v1/scan/" + id, {}, signal);
    if (
      d["scan_id"] !== id ||
      typeof d["status"] !== "string" ||
      !["pending", "scanning", "completed", "failed"].includes(d["status"])
    )
      throw new BouncerFailure("invalid_response");
    const result: BouncerResult = { scanId: id, status: d["status"] as BouncerResult["status"] };
    if (result.status === "completed") {
      const file = record(d["file"]);
      if (
        typeof d["verdict"] !== "string" ||
        !["clean", "malicious", "suspicious"].includes(d["verdict"]) ||
        typeof file["sha256"] !== "string" ||
        !/^[0-9a-f]{64}$/.test(file["sha256"]) ||
        !Number.isSafeInteger(file["size"]) ||
        Number(file["size"]) <= 0 ||
        Number(file["size"]) > MAX_PDF_BYTES
      )
        throw new BouncerFailure("invalid_response");
      result.verdict = d["verdict"] as NonNullable<BouncerResult["verdict"]>;
      result.sha256 = file["sha256"];
      result.byteSize = Number(file["size"]);
    }
    return result;
  }
  async health(signal?: AbortSignal): Promise<ScannerHealth> {
    // Quota-only probe never uploads a test file or consumes a scan.
    try {
      const usage = await this.usage(signal);
      return {
        ready: usage.used < usage.limit,
        reachable: true,
        engineAvailable: false,
        signaturesAvailable: false,
        fresh: false,
        testObjectPassed: false,
      };
    } catch {
      return {
        ready: false,
        reachable: false,
        engineAvailable: false,
        signaturesAvailable: false,
        fresh: false,
        testObjectPassed: false,
        category: "unavailable",
      };
    }
  }
  async scan(): Promise<ScanResult> {
    throw Error("Bouncer requires durable asynchronous worker orchestration");
  }
}
