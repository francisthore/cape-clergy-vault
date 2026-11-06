import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectLocalDatabase } from "../../database/connection.server.ts";
const owner = await connectLocalDatabase(),
  root = await mkdtemp(join(tmpdir(), "cape-phase4-http-")),
  secret = randomUUID(),
  origin = "http://localhost:3224";
const child = spawn(process.execPath, [".output/server/index.mjs"], {
  stdio: "ignore",
  env: {
    PATH: process.env["PATH"],
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "3224",
    CAPE_RUNTIME_DATABASE_URL: process.env["CAPE_RUNTIME_DATABASE_URL"],
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: secret,
    CAPE_STORAGE_ROOT: root,
    EMAIL_PROVIDER: "development",
    CAPE_LOCAL_EMAIL_CAPTURE: "true",
    CAPE_TRUSTED_PROXY_IPS: "127.0.0.1",
  },
});
const keys: string[] = [];
function key(address: string) {
  const digest = createHmac("sha256", secret)
    .update("auth:" + address)
    .digest("hex");
  return "auth:" + digest;
}
try {
  let started = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin + "/health/live")).ok) {
        started = true;
        break;
      }
    } catch {
      /* wait for disposable server */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(started, "built server starts");
  for (const ip of ["198.51.100.11", "198.51.100.12"]) {
    keys.push(key(ip));
    const response = await fetch(origin + "/api/auth/account", {
      headers: { "x-forwarded-for": ip, forwarded: "for=192.0.2.1", "x-real-ip": "192.0.2.2" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "signed-out" });
    const [row] = await owner.client`select hits from app.rate_limits where key=${key(ip)}`;
    assert.equal(
      row?.["hits"],
      1,
      "actual Node peer metadata allows only explicit one-hop trusted forwarding",
    );
  }
  keys.push(key("invalid-proxy"));
  const malformed = await fetch(origin + "/api/auth/account", {
    headers: { "x-forwarded-for": "198.51.100.11, 198.51.100.12" },
  });
  assert.equal(malformed.status, 200);
  const [invalid] =
    await owner.client`select hits from app.rate_limits where key=${key("invalid-proxy")}`;
  assert.equal(invalid?.["hits"], 1);
  assert.equal((await fetch(origin + "/health/ready")).status, 200);
  console.log(
    "PASS: built Node trusted socket peer, explicit single-hop forwarding, isolated client buckets, malformed chain fallback and scanner-degraded HTTP 200.",
  );
} finally {
  child.kill("SIGTERM");
  await once(child, "exit");
  await owner.client`delete from app.rate_limits where key=any(${keys})`;
  await owner.close();
  await rm(root, { recursive: true });
}
