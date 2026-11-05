import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { readdir, readFile, unlink, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { hashPassword } from "better-auth/crypto";
import { connectLocalDatabase } from "../../database/connection.server.ts";
const owner = await connectLocalDatabase();
const origin = "http://localhost:3214",
  password = "Disposable Phase 3D HTTP smoke passphrase";
const prefix = "smoke3d-" + randomUUID(),
  address = prefix + "@example.invalid",
  operator = prefix + "-operator";
const root = await mkdtemp(join(tmpdir(), "cape-http3d-"));
const guard = join(root, "network-guard.mjs");
await writeFile(
  guard,
  "globalThis.fetch = async () => { throw new Error('External fetch forbidden in HTTP smoke'); };",
  { mode: 0o600 },
);
const ids = [operator];
const child = spawn(process.execPath, ["--import", guard, ".output/server/index.mjs"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "3214",
    NODE_ENV: "production",
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    EMAIL_PROVIDER: "development",
    CAPE_LOCAL_EMAIL_CAPTURE: "true",
    RESEND_API_KEY: "",
    CAPE_STORAGE_ROOT: root,
    CAPE_STORAGE_PROVIDER: "local",
    CAPE_DOCUMENT_TYPES: "pdf",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
child.stderr.on("data", () => {
  /* Never expose request/secret material. */
});
const [initial] = await owner.client`select * from app.email_settings`;
const [initialDomain] =
  await owner.client`select authorized_at from app.email_domains where domain='notifications.ctdiocese.org.za'`;
const call = (path: string, cookie = "", body?: unknown) =>
  fetch(origin + path, {
    redirect: "manual",
    headers: { cookie, origin, "Content-Type": "application/json" },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
  });
const authPost = (path: string, body: unknown, cookie = "") =>
  call("/api/auth/" + path, cookie, body);
function cookieOf(r: Response) {
  return r.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
}
const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
try {
  let ready = false;
  for (let n = 0; n < 60; n++) {
    assert.equal(child.exitCode, null);
    try {
      if ((await fetch(origin + "/auth")).status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* startup */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready);
  for (const path of [
    "/api/submissions",
    "/api/repository",
    "/api/settings/email",
    "/admin/settings/email",
    "/submissions",
    "/repository",
  ]) {
    const r = await call(path);
    assert.equal(r.status, 403, path);
    assert.match(r.headers.get("cache-control")!, /no-store/);
  }
  await owner.client`update app.email_settings set transactional_enabled=true,notifications_enabled=true where id=1`;
  await owner.client`insert into auth.users(id,name,email,email_verified) values(${operator},'Disposable operator',${operator + "@example.invalid"},true)`;
  const hash = await hashPassword(password);
  await owner.client`insert into auth.accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) values(${randomUUID()},${operator},'credential',${operator},${hash},now(),now())`;
  await owner.client`insert into app.clergy_profiles(user_id,full_name,approval_status) values(${operator},'Disposable operator','approved')`;
  await owner.client`insert into app.role_assignments(user_id,role) values(${operator},'approver')`;
  await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${operator},'repository-v1','repository','accepted')`;
  await owner.client`select app.authorize_settings_manager(${operator},${"GRANT SETTINGS MANAGER " + operator})`;
  const operatorLogin = await authPost("sign-in/email", {
    email: operator + "@example.invalid",
    password,
  });
  assert.equal(operatorLogin.status, 200);
  const operatorCookie = cookieOf(operatorLogin);
  assert.equal((await call("/admin/settings/email", operatorCookie)).status, 200);
  const settings = await (await call("/api/settings/email", operatorCookie)).json();
  await owner.client`update app.email_domains set authorized_at=now() where domain='notifications.ctdiocese.org.za'`;
  assert.equal(
    (
      await call("/api/settings/email", operatorCookie, {
        version: settings.settings.version,
        sendingDomain: "notifications.ctdiocese.org.za",
        displayName: "HTTP dynamic sender",
        fromEmail: "http-test@notifications.ctdiocese.org.za",
        replyTo: "",
        transactionalEnabled: true,
        notificationsEnabled: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await authPost("register", {
        email: address,
        password,
        confirmPassword: password,
        title: "Rev.",
        fullName: "Disposable HTTP clergy",
        parish: "Test parish",
        phone: "",
        acknowledged: true,
        noticeVersion: "repository-v1",
      })
    ).status,
    200,
  );
  const [identity] = await owner.client`select id from auth.users where email=${address}`;
  assert.ok(identity);
  const target = String(identity["id"]);
  ids.push(target);
  let link = "";
  for (const file of await readdir(".local/email")) {
    const mail = JSON.parse(await readFile(".local/email/" + file, "utf8"));
    if (mail.to === address && mail.subject.startsWith("Verify")) {
      assert.match(mail.from, /HTTP dynamic sender/);
      link = mail.text.match(/https?:\/\/[^\s]+/)[0];
    }
  }
  assert.ok(link);
  assert.equal((await fetch(link, { redirect: "manual" })).status, 302);
  const login = await authPost("sign-in/email", { email: address, password });
  assert.equal(login.status, 200);
  const cookie = cookieOf(login);
  assert.equal((await call("/api/submissions", cookie)).status, 403);
  assert.equal(
    (
      await call("/api/registrations", operatorCookie, {
        targetId: target,
        action: "approve",
        reason: "Disposable HTTP sequence",
        requestId: randomUUID(),
      })
    ).status,
    200,
  );
  assert.equal((await call("/api/settings/email", cookie)).status, 403);
  const created = await call("/api/submissions", cookie, {
    action: "save",
    version: 0,
    kind: "document",
    title: "HTTP disposable document",
    category: "General",
    abstract: "A disposable document created through the full HTTP sequence.",
    keywords: [prefix],
    confidential: false,
  });
  assert.equal(created.status, 200);
  const submission = (await created.json()).id;
  const detailPage = await call("/submissions/" + submission, cookie);
  assert.equal(detailPage.status, 200);
  assert.match(detailPage.headers.get("cache-control")!, /no-store/);
  const uploaded = await fetch(
    origin + `/api/documents?submissionId=${submission}&requestId=${randomUUID()}`,
    {
      method: "POST",
      headers: {
        cookie,
        origin,
        "Content-Type": "application/pdf",
        "X-Document-Name": "disposable.pdf",
      },
      body: pdf,
    },
  );
  assert.equal(uploaded.status, 201);
  const document = (await uploaded.json()).id;
  assert.equal(
    (await call("/api/submissions", cookie, { action: "submit", id: submission, version: 1 }))
      .status,
    200,
  );
  const mine = await (await call("/api/submissions", cookie)).json();
  assert.equal(mine.total, 1);
  assert.equal(mine.items[0].status, "submitted");
  assert.equal((await (await call("/api/repository?keyword=" + prefix, cookie)).json()).total, 0);
  // Explicitly authorized disposable fixture only; no reviewer decision endpoint exists.
  await owner.client`update app.submissions set status='accepted' where id=${submission}`;
  assert.equal((await (await call("/api/repository?keyword=" + prefix, cookie)).json()).total, 1);
  const bytes = await call("/api/documents/" + document + "/download", cookie);
  assert.equal(bytes.status, 200);
  assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), pdf);
  await owner.client`update app.submissions set confidential=true where id=${submission}`;
  assert.equal(
    (await (await call("/api/repository?keyword=" + prefix, operatorCookie)).json()).total,
    0,
  );
  assert.equal((await call("/api/repository?id=" + submission, operatorCookie)).status, 404);
  assert.equal(
    (await call("/api/documents/" + document + "/download", operatorCookie)).status,
    404,
  );
  await owner.client`update app.settings_managers set revoked_at=now() where user_id=${operator}`;
  assert.equal((await call("/admin/settings/email", operatorCookie)).status, 403);
  assert.equal((await authPost("sign-out", {}, cookie)).status, 200);
  assert.equal((await call("/api/submissions", cookie)).status, 403);
  console.log(
    "PASS: built Node HTTP registration → verification → approval → draft → PDF upload → submission → owner listing; dynamic sender, repository confidentiality, audited bytes, settings isolation/revocation and signout. No browser engine used.",
  );
} finally {
  child.kill("SIGTERM");
  if (child.exitCode === null) await once(child, "exit");
  const users =
    await owner.client`select id from auth.users where email=${address} or id=${operator}`;
  const cleanupIds = users.map((r) => String(r["id"]));
  await owner.client.begin(async (tx) => {
    const history = [
      "audit_events",
      "account_approval_events",
      "popia_consent_events",
      "submission_events",
      "email_settings_history",
      "email_test_attempts",
    ];
    for (const table of history) await tx.unsafe(`alter table app.${table} disable trigger user`);
    await tx`update app.email_settings set sending_domain=${initial!["sending_domain"]},display_name=${initial!["display_name"]},from_email=${initial!["from_email"]},reply_to=${initial!["reply_to"]},transactional_enabled=${initial!["transactional_enabled"]},notifications_enabled=${initial!["notifications_enabled"]},version=${initial!["version"]},updated_at=${initial!["updated_at"]},updated_by=${initial!["updated_by"]} where id=1`;
    await tx`update app.email_domains set authorized_at=${initialDomain!["authorized_at"]} where domain='notifications.ctdiocese.org.za'`;
    await tx`delete from app.submission_events where actor_id=any(${cleanupIds})`;
    await tx`delete from app.documents where submission_id in(select id from app.submissions where owner_id=any(${cleanupIds}))`;
    await tx`delete from app.submissions where owner_id=any(${cleanupIds})`;
    await tx`delete from app.email_settings_history where actor_id=any(${cleanupIds})`;
    await tx`delete from app.email_test_attempts where actor_id=any(${cleanupIds})`;
    await tx`delete from app.audit_events where actor_id=any(${cleanupIds}) or target_user_id=any(${cleanupIds})`;
    await tx`delete from app.account_approval_events where user_id=any(${cleanupIds})`;
    await tx`delete from app.popia_consent_events where user_id=any(${cleanupIds})`;
    await tx`delete from app.approval_notifications where user_id=any(${cleanupIds})`;
    await tx`delete from app.settings_managers where user_id=any(${cleanupIds})`;
    await tx`delete from app.role_assignments where user_id=any(${cleanupIds})`;
    await tx`delete from app.clergy_profiles where user_id=any(${cleanupIds})`;
    await tx`delete from auth.users where id=any(${cleanupIds})`;
    for (const table of history) await tx.unsafe(`alter table app.${table} enable trigger user`);
  });
  for (const file of await readdir(".local/email")) {
    const path = ".local/email/" + file;
    const mail = JSON.parse(await readFile(path, "utf8"));
    if ([address, operator + "@example.invalid"].includes(mail.to)) await unlink(path);
  }
  await rm(root, { recursive: true, force: true });
  await owner.close();
}
