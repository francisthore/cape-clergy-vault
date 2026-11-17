import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  BouncerScanner,
  BouncerFailure,
  BOUNCER_V1_MAX_BYTES,
  validateUploadTarget,
} from "./bouncer.server.ts";
const host = "bouncer-dev-uploads-fixture.s3.ap-south-1.amazonaws.com";
const id = "scan_fixture";
const pdf = Buffer.from("%PDF-1.4\nDisposable provider fixture\n%%EOF\n");
const sha = createHash("sha256").update(pdf).digest("hex");
const json = (data: unknown, status = 200) =>
  Response.json({ status: "success", data }, { status });
export const usageFixture = (used = 0) => {
  const now = new Date();
  return {
    period: now.toISOString().slice(0, 7),
    scans_used: used,
    scans_limit: 500,
    tier: "free",
    resets_at: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
};
async function* bytes(size = pdf.length) {
  for (let offset = 0; offset < size; offset += 65536)
    yield Buffer.alloc(Math.min(65536, size - offset));
}
const make = (handler: (url: string, init: RequestInit) => Promise<Response> | Response) =>
  new BouncerScanner({
    apiKey: "private-fixture-key",
    uploadHost: host,
    fetch: (async (url, init) => handler(String(url), init!)) as typeof fetch,
  });
const category = (expected: string) => (error: unknown) =>
  error instanceof BouncerFailure && error.category === expected;

test("small upload uses authenticated v1, bounded multipart and neutral filename", async () => {
  let accepted = "";
  const scanner = make(async (url, init) => {
    assert.equal(url, "https://api.usebouncer.dev/v1/scan");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("X-API-Key"), "private-fixture-key");
    const chunks: Buffer[] = [];
    for await (const b of init.body as unknown as AsyncIterable<Buffer>) chunks.push(b);
    const body = Buffer.concat(chunks);
    assert.match(body.toString(), /filename="document.pdf"/);
    assert.equal(body.length, Number(new Headers(init.headers).get("Content-Length")));
    return json({ scan_id: id, status: "pending" }, 202);
  });
  await scanner.submit(bytes(), pdf.length, async (value) => {
    accepted = value;
  });
  assert.equal(accepted, id);
});
test("large upload persists ID before streaming to exact pinned S3 with no API key", async () => {
  let saved = false,
    calls = 0;
  const size = BOUNCER_V1_MAX_BYTES + 1;
  const scanner = make(async (url, init) => {
    calls++;
    if (url.endsWith("/v2/scan")) {
      assert.deepEqual(JSON.parse(String(init.body)), {
        file_name: "document.pdf",
        mime_type: "application/pdf",
      });
      return json(
        {
          scan_id: id,
          status: "pending",
          max_file_size: 26214400,
          upload: {
            url: `https://${host}/`,
            fields: { key: `uploads/${id}/document.pdf`, policy: "private-policy" },
          },
        },
        201,
      );
    }
    assert.ok(saved);
    assert.equal(url, `https://${host}/`);
    assert.equal(new Headers(init.headers).has("X-API-Key"), false);
    let length = 0;
    for await (const chunk of init.body as unknown as AsyncIterable<Buffer>) length += chunk.length;
    assert.equal(length, Number(new Headers(init.headers).get("Content-Length")));
    return new Response(null, { status: 204 });
  });
  await scanner.submit(bytes(size), size, async () => {
    saved = true;
  });
  assert.equal(calls, 2);
});
test("async statuses and all documented completed verdicts parse with exact identity", async () => {
  for (const status of ["pending", "scanning", "failed", "completed"]) {
    for (const verdict of ["clean", "malicious", "suspicious"]) {
      const scanner = make(() =>
        json({ scan_id: id, status, verdict, file: { sha256: sha, size: pdf.length } }),
      );
      const result = await scanner.poll(id);
      assert.equal(result.status, status);
      assert.equal(result.verdict, status === "completed" ? verdict : undefined);
    }
  }
});
test("missing evidence, malformed API, mismatched ID, unknown verdict/status, huge response fail closed", async () => {
  for (const data of [
    null,
    {},
    { scan_id: "scan_other", status: "pending" },
    { scan_id: id, status: "complete" },
    { scan_id: id, status: ["completed"], verdict: "clean", file: { sha256: sha, size: 5 } },
    { scan_id: id, status: "completed", verdict: ["clean"], file: { sha256: sha, size: 5 } },
    { scan_id: id, status: "completed", verdict: "clean" },
    { scan_id: id, status: "completed", verdict: "unknown", file: { sha256: sha, size: 5 } },
  ]) {
    await assert.rejects(make(() => json(data)).poll(id), category("invalid_response"));
  }
  await assert.rejects(make(() => new Response("not JSON")).poll(id), category("invalid_response"));
  await assert.rejects(
    make(() => new Response("x".repeat(65537))).poll(id),
    category("invalid_response"),
  );
});
test("unsafe presigned destinations, credentials, regions, paths, fields and redirects are refused", async () => {
  for (const url of [
    "http://" + host,
    "https://127.0.0.1/",
    "https://" + host + ".evil.invalid/",
    "https://" + host + ":444/",
    "https://user:pass@" + host + "/",
    "https://" + host + "/secret",
    "https://" + host + "/?redirect=secret",
    "https://bouncer-dev-uploads-fixture.s3.eu-west-1.amazonaws.com/",
  ]) {
    assert.throws(() =>
      validateUploadTarget({ url, fields: { key: `uploads/${id}/document.pdf` } }, host, id),
    );
  }
  assert.throws(() =>
    validateUploadTarget(
      { url: `https://${host}/`, fields: { key: "uploads/scan_other/document.pdf" } },
      host,
      id,
    ),
  );
  assert.throws(() =>
    validateUploadTarget(
      {
        url: `https://${host}/`,
        fields: { key: `uploads/${id}/document.pdf`, policy: "x\r\ninject" },
      },
      host,
      id,
    ),
  );
  const scanner = make(
    () => new Response(null, { status: 302, headers: { Location: "https://evil.invalid" } }),
  );
  await assert.rejects(scanner.poll(id), category("unavailable"));
});
test("quota checks enforce current free tier and 500 ceiling without paid fallback", async () => {
  assert.equal((await make(() => json(usageFixture(500))).usage()).used, 500);
  for (const change of [
    { tier: "pro" },
    { scans_limit: 501 },
    { scans_used: -1 },
    { period: "2000-01" },
    { resets_at: "2000-01-01T00:00:00Z" },
  ]) {
    await assert.rejects(make(() => json({ ...usageFixture(), ...change })).usage());
  }
  await assert.rejects(make(() => new Response(null, { status: 429 })).usage(), category("quota"));
});
test("provider timeout and network failure expose only sanitized categories", async () => {
  const scanner = make(() => {
    throw Error("secret-key private path");
  });
  await assert.rejects(scanner.poll(id), category("unavailable"));
  const aborted = AbortSignal.abort();
  const timed = make((_url, init) => {
    init.signal?.throwIfAborted();
    return json({});
  });
  await assert.rejects(timed.poll(id, aborted), category("timeout"));
});

test("configuration accepts only real providers and production rejects explicit test injection", async () => {
  const { configuredScanner } = await import("./scanner.server.ts");
  const { TestScanner } = await import("./testing.ts");
  const { runScanWorker } = await import("./worker.server.ts");
  const keys = ["CAPE_SCANNER", "BOUNCER_API_KEY", "BOUNCER_UPLOAD_HOST", "NODE_ENV"] as const;
  const saved = keys.map((key) => process.env[key]);
  try {
    process.env["CAPE_SCANNER"] = "bouncer";
    process.env["BOUNCER_API_KEY"] = "private-fixture-key";
    process.env["BOUNCER_UPLOAD_HOST"] = host;
    assert.ok(configuredScanner() instanceof BouncerScanner);
    process.env["CAPE_SCANNER"] = "clamav";
    assert.equal(configuredScanner().name, "ClamAV");
    for (const unknown of ["test", "unknown", "BOUNCER"]) {
      process.env["CAPE_SCANNER"] = unknown;
      assert.throws(() => configuredScanner());
    }
    process.env["NODE_ENV"] = "production";
    const fixture = new TestScanner();
    await assert.rejects(fixture.scan(bytes()), /forbidden in production/);
    await assert.rejects(
      runScanWorker(
        {} as import("postgres").Sql,
        {} as import("../documents/storage.server.ts").StorageProvider,
        fixture,
      ),
      /Production requires/,
    );
  } finally {
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
  }
});

test("4 MiB route boundary and missing host reject large submissions before any provider call", async () => {
  let calls = 0;
  const small = new BouncerScanner({
    apiKey: "synthetic-only",
    uploadHost: "",
    fetch: (async () => {
      calls++;
      throw Error("Unexpected provider call");
    }) as typeof fetch,
  });
  for (const size of [BOUNCER_V1_MAX_BYTES - 1, BOUNCER_V1_MAX_BYTES])
    assert.doesNotThrow(() => small.canSubmit(size));
  for (const size of [BOUNCER_V1_MAX_BYTES + 1, 20 * 1024 * 1024]) {
    await assert.rejects(
      small.submit(bytes(size), size, async () => {}),
      category("unsafe_destination"),
    );
  }
  assert.equal(calls, 0);
  const large = make(() => {
    throw Error("No provider call expected");
  });
  assert.doesNotThrow(() => large.canSubmit(20 * 1024 * 1024));
  assert.throws(() => large.canSubmit(20 * 1024 * 1024 + 1), category("invalid_response"));
});
