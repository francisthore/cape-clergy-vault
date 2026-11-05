import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile, unlink } from "node:fs/promises";
import { connectLocalDatabase } from "../../database/connection.server.ts";

// Real built Node server, real HTTP routing and Set-Cookie, captured local mail.
// This is an HTTP smoke test, not browser E2E coverage.
const owner = await connectLocalDatabase();
const baseURL = "http://localhost:3211";
const address = `smoke3b-${randomUUID()}@example.invalid`;
const targetId = `smoke3b-target-${randomUUID()}`;
const targetAddress = `${targetId}@example.invalid`;
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
  for (const path of [
    "/admin/registrations",
    "/admin/registrations/" + targetId,
    "/api/registrations",
  ]) {
    const denied = await fetch(baseURL + path, { redirect: "manual" });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("cache-control"), "no-store");
  }
  assert.equal((await post("bootstrap-approver", {})).status, 404);
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
  assert.equal(
    (await fetch(`${baseURL}/admin/registrations`, { headers: { cookie } })).status,
    403,
  );
  // Disposable operator-seeded authority; never establish a real bootstrap marker in an HTTP smoke test.
  const [actor] = await owner.client`select id from auth.users where email=${address}`;
  const actorId = String(actor!["id"]);
  await owner.client`update app.clergy_profiles set approval_status='approved' where user_id=${actorId}`;
  await owner.client`insert into app.role_assignments(user_id,role) values(${actorId},'approver')`;
  await owner.client`insert into auth.users(id,name,email,email_verified) values(${targetId},'Smoke target',${targetAddress},true)`;
  await owner.client`insert into app.clergy_profiles(user_id,full_name,title,parish) values(${targetId},'Smoke target','Rev.','Local fixture')`;
  await owner.client`insert into app.role_assignments(user_id,role) values(${targetId},'clergy')`;
  const adminPage = await fetch(`${baseURL}/admin/registrations`, { headers: { cookie } });
  assert.equal(adminPage.status, 200);
  assert.equal(adminPage.headers.get("cache-control"), "no-store");
  assert.match(await adminPage.text(), /Clergy registrations/);
  const detailPage = await fetch(`${baseURL}/admin/registrations/${targetId}`, {
    headers: { cookie },
  });
  assert.equal(detailPage.status, 200);
  assert.match(await detailPage.text(), /Registration review/);
  const query = await fetch(`${baseURL}/api/registrations?id=${targetId}`, { headers: { cookie } });
  assert.equal(query.status, 200);
  assert.equal((await query.json()).approval_status, "pending");
  const decide = () =>
    fetch(`${baseURL}/api/registrations`, {
      method: "POST",
      headers: { origin: baseURL, cookie, "content-type": "application/json" },
      body: JSON.stringify(intent),
    });
  const intent = { targetId, action: "approve", reason: "", requestId: randomUUID() };
  assert.equal((await decide()).status, 200);
  assert.equal((await decide()).status, 200);
  const after = await (
    await fetch(`${baseURL}/api/registrations?id=${targetId}`, { headers: { cookie } })
  ).json();
  assert.equal(after.approval_status, "approved");
  assert.equal(after.history.length, 1);
  await owner.client`update app.role_assignments set revoked_at=now() where user_id=${actorId} and role='approver'`;
  assert.equal(
    (await fetch(`${baseURL}/admin/registrations`, { headers: { cookie } })).status,
    403,
  );
  assert.equal((await decide()).status, 403);
  const legacy = await fetch(`${baseURL}/dashboard`, { headers: { cookie }, redirect: "manual" });
  assert.ok([302, 307].includes(legacy.status));
  assert.equal((await post("sign-out", {}, cookie)).status, 200);
  assert.equal(
    (await (await fetch(`${baseURL}/api/auth/account`, { headers: { cookie } })).json()).status,
    "signed-out",
  );
  console.log(
    "PASS: built Node HTTP registration, verified cookies, unauthorized admin page/API rejection, authorized list/detail routes, atomic approval, idempotency, permission revocation and logout.",
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
      const users =
        await tx`select id from auth.users where email=${address} or email=${targetAddress}`;
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
