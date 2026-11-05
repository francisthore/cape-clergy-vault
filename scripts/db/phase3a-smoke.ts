import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile, unlink } from "node:fs/promises";
import { connectLocalDatabase } from "../../database/connection.server.ts";

// Real built Node server, real HTTP routing and Set-Cookie, captured local mail.
// This is an HTTP smoke test, not browser E2E coverage.
const owner = await connectLocalDatabase();
const baseURL = "http://localhost:3211";
const address = `smoke3a-${randomUUID()}@example.invalid`;
const child = spawn(process.execPath, [".output/server/index.mjs"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "3211",
    NODE_ENV: "production",
    BETTER_AUTH_URL: baseURL,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    EMAIL_PROVIDER: "development",
    CAPE_LOCAL_EMAIL_CAPTURE: "true",
    // Smoke test deliberately ignores any supplied real email configuration.
    RESEND_API_KEY: "",
    EMAIL_FROM: "Local <local@example.invalid>",
    EMAIL_REPLY_TO: "",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let serverErrors = "";
child.stderr.on("data", (data: Buffer) => {
  serverErrors += data.toString();
});
const createdFiles: string[] = [];
const post = (path: string, body: unknown, cookie = "") =>
  fetch(`${baseURL}/api/auth/${path}`, {
    method: "POST",
    headers: { origin: baseURL, cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
  });
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error("Node server exited before startup");
    try {
      const response = await fetch(`${baseURL}/auth`);
      if (response.status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* Starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, "Node server starts");
  const page = await fetch(`${baseURL}/auth?view=register`);
  assert.match(await page.text(), /Clergy registration/);
  const password = "local smoke unique long passphrase";
  const register = await post("register", {
    title: "Rev.",
    fullName: "Smoke Test",
    parish: "Local test",
    phone: "",
    acknowledged: true,
    noticeVersion: "repository-v1",
    email: address,
    password,
    confirmPassword: password,
  });
  assert.equal(register.status, 200, await register.clone().text());
  const files = await readdir(".local/email");
  let verification = "";
  for (const file of files) {
    const path = `.local/email/${file}`;
    const message = JSON.parse(await readFile(path, "utf8")) as {
      to: string;
      text: string;
      subject: string;
    };
    if (message.to === address) {
      createdFiles.push(path);
      if (message.subject.startsWith("Verify"))
        verification = message.text.match(/https?:\/\/[^\s]+/)![0];
    }
  }
  assert.ok(verification, "Verification message captured privately");
  assert.equal((await post("sign-in/email", { email: address, password })).status, 401);
  const verified = await fetch(verification, { redirect: "manual" });
  assert.equal(verified.status, 302);
  assert.match(verified.headers.get("location")!, /view=verified/);
  const login = await post("sign-in/email", { email: address, password });
  assert.equal(login.status, 200, await login.clone().text());
  const setCookies = login.headers.getSetCookie();
  assert.match(setCookies.join(";"), /HttpOnly/i);
  assert.match(setCookies.join(";"), /SameSite=Lax/i);
  const cookie = setCookies.map((v) => v.split(";")[0]).join("; ");
  const state = await fetch(`${baseURL}/api/auth/account`, { headers: { cookie } });
  assert.equal((await state.json()).status, "pending");
  const legacy = await fetch(`${baseURL}/dashboard`, { headers: { cookie }, redirect: "manual" });
  assert.ok([302, 307].includes(legacy.status));
  assert.equal((await post("sign-out", {}, cookie)).status, 200);
  assert.equal(
    (await (await fetch(`${baseURL}/api/auth/account`, { headers: { cookie } })).json()).status,
    "signed-out",
  );
  console.log(
    "PASS: built Node HTTP registration, captured mail, verification, cookie login, pending state, legacy isolation and session-invalidating logout.",
  );
} catch (error) {
  // Never print requests, cookies, mail, environment or tokens.
  console.error(
    "Node HTTP smoke test failed. Server emitted error categories:",
    serverErrors.includes("auth.request_failed")
      ? "auth.request_failed"
      : "inspect local server configuration",
  );
  throw error;
} finally {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", () => resolve());
  });
  try {
    await owner.client.begin(async (tx) => {
      const users = await tx`select id from auth.users where email=${address}`;
      const ids = users.map((r) => r["id"] as string);
      for (const table of ["audit_events", "account_approval_events", "popia_consent_events"])
        await tx.unsafe(`alter table app.${table} disable trigger user`);
      await tx`delete from app.audit_events where actor_id=any(${ids})`;
      await tx`delete from app.account_approval_events where user_id=any(${ids})`;
      await tx`delete from app.popia_consent_events where user_id=any(${ids})`;
      await tx`delete from app.approval_notifications where user_id=any(${ids})`;
      await tx`delete from app.role_assignments where user_id=any(${ids})`;
      await tx`delete from app.clergy_profiles where user_id=any(${ids})`;
      await tx`delete from auth.users where id=any(${ids})`;
      for (const table of ["audit_events", "account_approval_events", "popia_consent_events"])
        await tx.unsafe(`alter table app.${table} enable trigger user`);
    });
    for (const file of await readdir(".local/email")) {
      const path = `.local/email/${file}`;
      if ((JSON.parse(await readFile(path, "utf8")) as { to: string }).to === address)
        await unlink(path);
    }
  } finally {
    await owner.close();
  }
}
