import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:net";
import { mkdtemp, rm, lstat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ClamAvScanner,
  MAX_SCAN_BYTES,
  configuredScanner,
  parseVerdict,
  parseVersion,
} from "./scanner.server.ts";
function version(age = 0) {
  const d = new Date(Date.now() - age * 3600000);
  return (
    "ClamAV 1.4.3/12345/" +
    d.toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) (\S+) GMT$/, "$1 $3 $2 $5 $4")
  );
}
async function* bytes() {
  yield Buffer.from("%PDF-1.4\nTest\n%%EOF\n");
}
async function daemon(work: (scanner: ClamAvScanner) => Promise<void>, mode = "clean") {
  const root = await mkdtemp(join(tmpdir(), "cape-clamd-")),
    path = join(root, "socket");
  let scans = 0;
  const server = createServer((socket) => {
    let all = Buffer.alloc(0),
      command = "",
      data = Buffer.alloc(0),
      done = false;
    socket.on("error", () => undefined);
    socket.on("data", (chunk) => {
      if (done) return;
      all = Buffer.concat([all, chunk]);
      if (!command) {
        const end = all.indexOf(0);
        if (end < 0) return;
        command = all.subarray(0, end).toString();
        all = all.subarray(end + 1);
        if (command === "zPING") {
          done = true;
          socket.end("PONG\0");
          return;
        }
        if (command === "zVERSIONCOMMANDS") {
          done = true;
          socket.end(version() + "| COMMANDS: PING VERSION VERSIONCOMMANDS INSTREAM\0");
          return;
        }
        if (command === "zVERSION") {
          done = true;
          socket.end(
            mode === "stale"
              ? version(96) + "\0"
              : mode === "missing"
                ? "ClamAV 1.4.3\0"
                : version() + "\0",
          );
          return;
        }
        assert.equal(command, "zINSTREAM");
      }
      if (command === "zINSTREAM" && scans >= 1 && mode === "earlysize") {
        done = true;
        socket.end("INSTREAM size limit exceeded. ERROR\0");
        return;
      }
      while (all.length >= 4) {
        const n = all.readUInt32BE();
        if (all.length < 4 + n) return;
        all = all.subarray(4);
        if (!n) {
          scans++;
          done = true;
          // First stream is health probe. Subsequent stream is the actual object.
          if (mode === "timeout" && scans > 1) return;
          if (mode === "crash" && scans > 1) {
            socket.destroy();
            return;
          }
          const reply =
            scans === 1
              ? "stream: OK"
              : mode === "infected"
                ? "stream: Safe.Test.Signature FOUND"
                : mode === "invalid"
                  ? "NOT A VERDICT"
                  : mode === "size"
                    ? "INSTREAM size limit exceeded. ERROR"
                    : mode === "incomplete"
                      ? "stream: OK"
                      : "stream: OK";
          socket.end(reply + (mode === "incomplete" && scans > 1 ? "" : "\0"));
          return;
        }
        assert.ok(n <= 65536, "bounded wire chunks");
        data = Buffer.concat([data, all.subarray(0, n)]);
        all = all.subarray(n);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  await chmod(path, mode === "unsafe" ? 0o666 : 0o600);
  try {
    await work(
      new ClamAvScanner({
        socketPath: path,
        scanTimeoutMs: 100,
        totalTimeoutMs: 1000,
        connectTimeoutMs: 100,
      }),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}
test("real Unix socket clamd INSTREAM protocol: bounded chunks and clean verdict", () =>
  daemon(async (scanner) => {
    const result = await scanner.scan(bytes());
    assert.equal(result.verdict, "clean");
    assert.ok(result.engine);
    assert.ok(result.definitionsAt);
  }));
for (const [mode, verdict, category] of [
  ["infected", "infected", undefined],
  ["invalid", "error", "invalid_response"],
  ["size", "error", "size_limit"],
  ["timeout", "error", "timeout"],
  ["crash", "error", "invalid_response"],
  ["incomplete", "error", "invalid_response"],
  ["stale", "unavailable", "definitions_stale"],
  ["missing", "unavailable", "definitions_missing"],
] as const)
  test("protocol " + mode, () =>
    daemon(async (scanner) => {
      const r = await scanner.scan(bytes());
      assert.equal(r.verdict, verdict);
      if (category)
        assert.ok(
          r.category === category || (mode === "crash" && r.category === "disconnected"),
          r.category,
        );
    }, mode),
  );
test("unavailable socket fails closed", async () => {
  const r = await new ClamAvScanner({ socketPath: "/tmp/cape-no-such-scanner-" + Date.now() }).scan(
    bytes(),
  );
  assert.equal(r.verdict, "unavailable");
});
test("local stream ceiling, conservative parser and definition age", async () => {
  assert.equal(parseVerdict("stream: Heuristics.Limits.Exceeded FOUND").category, "size_limit");
  assert.equal(parseVerdict("stream: OK\nextra").verdict, "error");
  assert.throws(() => parseVersion(version(80), 48));
  await daemon(async (scanner) => {
    async function* oversized() {
      yield new Uint8Array(MAX_SCAN_BYTES + 1);
    }
    assert.equal((await scanner.scan(oversized())).category, "size_limit");
  });
});
test("early clamd size-limit reply is retained while stream writes are active", () =>
  daemon(async (scanner) => {
    async function* larger() {
      for (let i = 0; i < 20; i++) yield new Uint8Array(65536);
    }
    const result = await scanner.scan(larger());
    assert.equal(result.verdict, "error");
    assert.equal(result.category, "size_limit");
  }, "earlysize"));
test("world-accessible scanner sockets are rejected", () =>
  daemon(async (scanner) => {
    const health = await scanner.health();
    assert.equal(health.ready, false);
    assert.equal(health.reachable, false);
  }, "unsafe"));
test("test doubles cannot be selected by runtime configuration", () => {
  const previous = process.env["CAPE_SCANNER"];
  try {
    process.env["CAPE_SCANNER"] = "test";
    assert.throws(() => configuredScanner(), /Only ClamAV/);
  } finally {
    if (previous === undefined) delete process.env["CAPE_SCANNER"];
    else process.env["CAPE_SCANNER"] = previous;
  }
});
const actual = process.env["CAPE_CLAMD_SOCKET"] ?? "/run/clamav/clamd.sock";
let installed = false;
try {
  installed = (await lstat(actual)).isSocket();
} catch {
  /* Explicit skip below. */
}
test(
  "installed real ClamAV scans safe disposable object",
  {
    skip: !installed
      ? "No local clamd socket installed; no production service setup authorized"
      : false,
  },
  async () => {
    const scanner = new ClamAvScanner({ socketPath: actual });
    assert.equal((await scanner.health()).ready, true);
    assert.equal((await scanner.scan(bytes())).verdict, "clean");
  },
);
