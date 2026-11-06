import { randomUUID } from "node:crypto";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { hashPassword } from "better-auth/crypto";
import type { Page } from "@playwright/test";
import { connectLocalDatabase } from "../database/connection.server.ts";
import { cleanTestScanRows, scanTestDocument } from "../database/test-scanning.ts";
import { LocalPrivateStorageProvider } from "../src/lib/documents/storage.server.ts";
import { configuredEmail } from "../src/lib/email/service.server.ts";
import { deliverReviewerNotifications } from "../src/lib/reviews/notifications.server.ts";
import { createInvitationProof } from "../src/lib/reviews/tokens.server.ts";
export const origin = "http://localhost:3220",
  secret = "Disposable-browser-fixture-secret-Phase3F-ONLY",
  password = "Disposable Phase3F browser passphrase";
export async function fixtures() {
  const owner = await connectLocalDatabase(),
    prefix = "browser-p3f-" + randomUUID();
  const ids: string[] = [],
    keys: string[] = [];
  const identities = new Map<string, string>();
  const [settings] = await owner.client`select * from app.email_settings where id=1`;
  const [domain] =
    await owner.client`select authorized_at from app.email_domains where domain='notifications.ctdiocese.org.za'`;
  await owner.client`update app.email_settings set transactional_enabled=true,notifications_enabled=true`;
  // Capture-only test attestation is restored below; no DNS/Resend interaction.
  await owner.client`update app.email_domains set authorized_at=now() where domain='notifications.ctdiocese.org.za'`;
  const id = (name: string) => identities.get(name)!;
  const address = (name: string) => prefix + "-" + name + "@example.invalid";
  async function seed(name: string, status = "approved", roles: string[] = []) {
    const who = prefix + "-" + name;
    ids.push(who);
    identities.set(name, who);
    await owner.client`insert into auth.users(id,name,email,email_verified) values(${who},'Disposable browser fixture',${address(name)},true)`;
    await owner.client`insert into auth.accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) values(${randomUUID()},${who},'credential',${who},${await hashPassword(password)},now(),now())`;
    await owner.client`insert into app.clergy_profiles(user_id,full_name,title,parish,approval_status) values(${who},'Disposable browser fixture','Rev.','Test parish',${status})`;
    await owner.client`insert into app.role_assignments(user_id,role) values(${who},'clergy')`;
    for (const role of roles)
      await owner.client`insert into app.role_assignments(user_id,role) values(${who},${role})`;
    await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${who},'repository-v1','repository','accepted')`;
  }
  await seed("author");
  await seed("reader");
  await seed("reviewer");
  await seed("approver", "approved", ["approver"]);
  await seed("manager");
  await seed("pending", "pending");
  await seed("rejected", "pending");
  await owner.client`insert into app.settings_managers(user_id) values(${id("manager")})`;
  const savedCookies = new Map<
    string,
    Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>
  >();
  async function signIn(page: Page, name: string, pass = password) {
    // Respect the real per-process/IP rate limit; never weaken application controls.
    let times: number[] = [];
    try {
      times = JSON.parse(await readFile(".local/browser-login-times.json", "utf8"));
    } catch {
      /* A new isolated server has no previous login reservations. */
    }
    times = times.filter((time) => Date.now() - time < 62000);
    if (times.length >= 5) {
      await new Promise((resolve) => setTimeout(resolve, 62000 - (Date.now() - times[0]!)));
      times = times.filter((time) => Date.now() - time < 62000);
    }
    times.push(Date.now());
    await writeFile(".local/browser-login-times.json", JSON.stringify(times), { mode: 0o600 });
    await page.goto("/auth?view=login");
    await page.getByLabel("Email address", { exact: true }).fill(address(name));
    await page.getByLabel("Password", { exact: true }).fill(pass);
    const response = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/auth/sign-in/email",
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    return response;
  }
  async function login(page: Page, name: string, pass = password, reuse = false) {
    const cookies = savedCookies.get(name);
    if (reuse && cookies) {
      await page.context().clearCookies();
      await page.context().addCookies(cookies);
      await page.goto("/account");
      return;
    }
    const response = await signIn(page, name, pass);
    if (response.status() !== 200)
      throw Error("Disposable browser sign-in failed: " + response.status());
    await page.waitForURL("**/account");
    if (reuse) savedCookies.set(name, await page.context().cookies());
  }
  async function capture(name: string, subject: string) {
    for (let i = 0; i < 60; i++) {
      for (const file of await readdir(".local/email")) {
        const mail = JSON.parse(await readFile(".local/email/" + file, "utf8"));
        if (mail.to === address(name) && mail.subject.toLowerCase().includes(subject))
          return mail as { text: string };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error("Expected disposable captured email was not produced");
  }
  async function registered(name: string) {
    const [u] = await owner.client`select id from auth.users where email=${address(name)}`;
    if (!u) throw Error("Disposable registration missing");
    ids.push(String(u["id"]));
    identities.set(name, String(u["id"]));
  }
  async function invite() {
    const proof = createInvitationProof(secret, id("reviewer"));
    const [inv] =
      await owner.client`select app.reviewer_operator('invite',${id("reviewer")},null,${proof.digest},${proof.sealed},${"INVITE " + id("reviewer")},null) as id`;
    const [n] =
      await owner.client`select id from app.reviewer_notifications where invitation_id=${inv!["id"]}`;
    await deliverReviewerNotifications(
      owner,
      configuredEmail(origin, { NODE_ENV: "test", EMAIL_PROVIDER: "development" }, owner.client),
      origin,
      secret,
      1,
      String(n!["id"]),
    );
    const mail = await capture("reviewer", "invitation");
    return new URLSearchParams(
      new URL(mail.text.match(/https?:\/\/[^\s]+/)![0]!).hash.slice(1),
    ).get("token")!;
  }
  async function assign(submission: string) {
    const [s] = await owner.client`select revision from app.submissions where id=${submission}`;
    await owner.client`select app.reviewer_operator('assign',${id("reviewer")},${submission},null,null,${"ASSIGN " + id("reviewer") + " " + submission + " REVISION " + s!["revision"]},${s!["revision"]})`;
  }
  const scan = async (doc: string) =>
    scanTestDocument(doc, new LocalPrivateStorageProvider(".local/browser-storage"));
  async function cleanup() {
    const rows =
      await owner.client`select d.storage_key from app.documents d join app.submissions s on s.id=d.submission_id where s.owner_id=any(${ids})`;
    keys.push(...rows.map((r) => String(r["storage_key"])));
    await owner.client.begin(async (tx) => {
      const history = [
        "review_decisions",
        "reviewer_events",
        "submission_events",
        "audit_events",
        "popia_consent_events",
        "account_approval_events",
        "email_settings_history",
        "email_test_attempts",
      ];
      for (const table of history) await tx.unsafe(`alter table app.${table} disable trigger user`);
      const subs = await tx`select id from app.submissions where owner_id=any(${ids})`;
      const subIds = subs.map((s) => String(s["id"]));
      await tx`delete from app.reviewer_notifications where user_id=any(${ids})`;
      await tx`delete from app.reviewer_events where reviewer_id=any(${ids})`;
      await tx`delete from app.review_decisions where reviewer_id=any(${ids})`;
      await tx`delete from app.reviewer_assignments where reviewer_id=any(${ids})`;
      await tx`delete from app.reviewer_invitations where user_id=any(${ids})`;
      await tx`delete from app.submission_events where actor_id=any(${ids})`;
      await cleanTestScanRows(tx, subIds);
      await tx`delete from app.audit_events where actor_id=any(${ids}) or target_user_id=any(${ids}) or submission_id=any(${subIds})`;
      await tx`delete from app.documents where submission_id=any(${subIds})`;
      await tx`delete from app.submissions where id=any(${subIds})`;
      await tx`delete from app.popia_consent_events where user_id=any(${ids})`;
      await tx`delete from app.account_approval_events where user_id=any(${ids})`;
      await tx`delete from app.approval_notifications where user_id=any(${ids})`;
      await tx`delete from app.email_settings_history where actor_id=any(${ids})`;
      await tx`delete from app.email_test_attempts where actor_id=any(${ids})`;
      await tx`update app.email_settings set sending_domain=${settings!["sending_domain"]},display_name=${settings!["display_name"]},from_email=${settings!["from_email"]},reply_to=${settings!["reply_to"]},transactional_enabled=${settings!["transactional_enabled"]},notifications_enabled=${settings!["notifications_enabled"]},version=${settings!["version"]},updated_by=${settings!["updated_by"]},updated_at=${settings!["updated_at"]}`;
      await tx`update app.email_domains set authorized_at=${domain!["authorized_at"]} where domain='notifications.ctdiocese.org.za'`;
      await tx`delete from app.settings_managers where user_id=any(${ids})`;
      await tx`delete from app.role_assignments where user_id=any(${ids})`;
      await tx`delete from app.clergy_profiles where user_id=any(${ids})`;
      await tx`delete from auth.users where id=any(${ids})`;
      await tx`delete from auth.verifications where identifier like ${"%" + prefix + "%"} or value=any(${ids})`;
      for (const table of history) await tx.unsafe(`alter table app.${table} enable trigger user`);
    });
    for (const key of keys)
      await unlink(".local/browser-storage/" + key + ".blob").catch(() => undefined);
    for (const file of await readdir(".local/email")) {
      const mail = JSON.parse(await readFile(".local/email/" + file, "utf8"));
      if (String(mail.to).startsWith(prefix)) await unlink(".local/email/" + file);
    }
    await owner.close();
  }
  return {
    owner,
    prefix,
    id,
    address,
    login,
    signIn,
    capture,
    registered,
    invite,
    assign,
    scan,
    cleanup,
  };
}
