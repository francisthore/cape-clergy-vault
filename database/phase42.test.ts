import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { TransactionSql } from "postgres";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";
import { connectLocalNotifications } from "./notifications.server.ts";
import { readDisposableManifest, assertDisposableDatabase } from "./disposable-phase41b.server.ts";
import { createAuthService } from "../src/lib/auth/service.server.ts";
import { registrationNotice } from "../src/lib/auth/registration.ts";
import { EmailService, TestEmailProvider } from "../src/lib/email/service.server.ts";
import { deliverApprovalNotifications } from "../src/lib/approvals/notifications.server.ts";

test("Phase 4.2 disposable registration, consent, authorization and durable mail", async (t) => {
  const manifest = await readDisposableManifest();
  const owner = await connectLocalDatabase(),
    runtime = await connectLocalRuntime(),
    worker = await connectLocalNotifications();
  await assertDisposableDatabase(owner.client, manifest);
  const prefix = "p42-" + randomUUID(),
    origin = "http://localhost:3220";
  const provider = new TestEmailProvider();
  const email = new EmailService(provider, { from: "Capture <capture@example.invalid>", origin });
  const service = createAuthService(runtime, email, {
    secret: "Disposable-phase42-secret-with-at-least-32-characters",
    baseURL: origin,
  });
  const as = <T>(who: string, fn: (tx: TransactionSql) => Promise<T>) =>
    runtime.client.begin(async (tx) => {
      await tx`select set_config('cape.user_id',${who},true)`;
      return fn(tx);
    });
  const seed = async (
    label: string,
    status = "approved",
    roles: string[] = [],
    verified = true,
    version = "repository-v1",
  ) => {
    const who = `${prefix}-${label}`;
    await owner.client`insert into auth.users(id,name,email,email_verified) values(${who},'Synthetic clergy',${who + "@example.invalid"},${verified})`;
    await owner.client`insert into app.clergy_profiles(user_id,full_name,title,parish,approval_status) values(${who},'Synthetic clergy','Rev.','Synthetic parish',${status})`;
    for (const role of ["clergy", ...roles])
      await owner.client`insert into app.role_assignments(user_id,role) values(${who},${role})`;
    await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${who},${version},'repository','accepted')`;
    return who;
  };
  const notices = async (who: string) =>
    owner.client`select * from app.approval_notifications where user_id=${who} order by created_at,id`;
  const post = (path: string, body: unknown) =>
    service.handle(
      new Request(origin + "/api/auth/" + path, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  try {
    let zero = "";
    await t.test(
      "zero eligible approvers is explicit; unverified registration does not notify",
      async () => {
        zero = await seed("zero", "pending", [], false);
        assert.equal((await notices(zero)).length, 0);
        await owner.client`update auth.users set email_verified=true where id=${zero}`;
        assert.equal((await notices(zero)).length, 1);
        assert.equal(
          (
            await owner.client`select count(*)::int n from app.audit_events where target_user_id=${zero} and action='registration.approver_alert_no_recipients'`
          )[0]!["n"],
          1,
        );
      },
    );
    const approver = await seed("approver", "approved", ["approver"]);
    const legacy = await seed("legacy");
    const current = await seed("current", "approved", [], true, registrationNotice.version);
    await seed("admin-only", "approved", ["admin"]);
    await seed("unverified-approver", "approved", ["approver"], false);
    await seed("suspended-approver", "suspended", ["approver"]);
    const revoked = await seed("revoked-approver", "approved", ["approver"]);
    await owner.client`update app.role_assignments set revoked_at=now() where user_id=${revoked} and role='approver'`;
    await t.test("no backfill or delayed fallback on repeated verification", async () => {
      await owner.client`update auth.users set email_verified=true where id=${zero}`;
      assert.equal((await notices(zero)).length, 1);
      assert.equal((await notices(approver)).length, 0);
    });
    await t.test(
      "new and legacy acknowledgements retain eligibility without rewriting history",
      async () => {
        for (const who of [legacy, current])
          assert.equal(
            (await as(who, (tx) => tx`select app.has_consent('repository') ok`))[0]!["ok"],
            true,
          );
        assert.equal(
          (
            await owner.client`select notice_version from app.popia_consent_events where user_id=${legacy}`
          )[0]!["notice_version"],
          "repository-v1",
        );
        await as(
          legacy,
          (tx) =>
            tx`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${legacy},'repository-v1','repository','withdrawn')`,
        );
        assert.equal(
          (await as(legacy, (tx) => tx`select app.has_consent('repository') ok`))[0]!["ok"],
          false,
        );
        await as(
          current,
          (tx) =>
            tx`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${current},${registrationNotice.version},'repository','withdrawn')`,
        );
        assert.equal(
          (await as(current, (tx) => tx`select app.has_consent('repository') ok`))[0]!["ok"],
          false,
        );
      },
    );
    await t.test(
      "server rejects missing acknowledgement and retired registration version",
      async () => {
        const body = {
          title: "Rev.",
          fullName: "Synthetic registration",
          parish: "Synthetic parish",
          phone: "",
          email: prefix + "-new@example.invalid",
          password: "Synthetic registration password",
          confirmPassword: "Synthetic registration password",
          noticeVersion: registrationNotice.version,
        };
        assert.equal((await post("register", body)).status, 400);
        assert.equal(
          (await post("register", { ...body, acknowledged: true, noticeVersion: "repository-v1" }))
            .status,
          400,
        );
        assert.equal((await post("register", { ...body, acknowledged: true })).status, 200);
        const [u] = await owner.client`select id from auth.users where email=${body.email}`;
        assert.equal((await notices(String(u!["id"]))).length, 0);
        assert.equal(provider.messages.length, 1);
        const link = provider.messages[0]!.text.match(/https?:\/\/[^\s]+/)![0]!;
        const response = await service.handle(new Request(link));
        assert.equal(response.status, 302);
        assert.equal(
          (await notices(String(u!["id"]))).filter((n) => n["kind"] === "pending").length,
          1,
        );
      },
    );
    let candidate = "",
      alertId = "";
    await t.test(
      "only active verified approved approvers receive one alert with a minimal payload",
      async () => {
        candidate = await seed("candidate", "pending", [], false);
        const before = (await notices(approver)).length;
        await owner.client`update auth.users set email_verified=true where id=${candidate}`;
        await owner.client`update auth.users set email_verified=true where id=${candidate}`;
        const alerts = (await notices(approver)).filter(
          (n) => n["kind"] === "registration_pending_alert",
        );
        assert.equal(alerts.length, before + 1);
        alertId = String(alerts.at(-1)!["id"]);
        assert.equal(
          (
            await owner.client`select count(*)::int n from app.approval_notifications where kind='registration_pending_alert' and event_key like ${"registration-alert:" + (await notices(candidate))[0]!["id"] + ":%"}`
          )[0]!["n"],
          1,
        );
        const count = provider.messages.length;
        assert.equal(await deliverApprovalNotifications(worker, email, origin, 1, alertId), 1);
        const mail = provider.messages[count]!;
        assert.equal(mail.to, approver + "@example.invalid");
        assert.equal(mail.subject, "A clergy registration is awaiting review");
        assert.ok(mail.text.includes(origin + "/admin/registrations"));
        assert.ok(!mail.text.includes(candidate));
        assert.equal(await deliverApprovalNotifications(worker, email, origin, 1, alertId), 0);
      },
    );
    await t.test(
      "revocation after queueing cancels approver alerts before provider I/O",
      async () => {
        const late = await seed("late-approver", "approved", ["approver"]);
        await seed("later-candidate", "pending");
        const alert = (await notices(late))[0]!;
        await owner.client`update app.role_assignments set revoked_at=now() where user_id=${late} and role='approver'`;
        const count = provider.messages.length;
        assert.equal(
          await deliverApprovalNotifications(worker, email, origin, 1, String(alert["id"])),
          0,
        );
        assert.equal(provider.messages.length, count);
        assert.equal((await notices(late))[0]!["last_error"], "recipient_ineligible");
      },
    );
    const decision = (who: string, action: string, id: string, reason = "") =>
      as(approver, (tx) => tx`select app.decide_registration(${who},${action},${reason},${id})`);
    await t.test("rolled-back and invalid decisions create no durable outcome mail", async () => {
      const id = randomUUID();
      await assert.rejects(
        as(approver, async (tx) => {
          await tx`select app.decide_registration(${candidate},'approve','',${id})`;
          throw Error("Synthetic rollback");
        }),
      );
      assert.equal(
        (
          await owner.client`select count(*)::int n from app.approval_notifications where event_key=${id}`
        )[0]!["n"],
        0,
      );
      await assert.rejects(decision(candidate, "reactivate", randomUUID(), "Synthetic reason"));
    });
    for (const [action, kind, reason] of [
      ["approve", "approved", ""],
      ["suspend", "suspended", "Internal suspension evidence"],
      ["reactivate", "reactivated", "Internal reactivation evidence"],
    ]) {
      await t.test(
        `${action} commits one idempotent intent and delivers through the restricted worker`,
        async () => {
          const id = randomUUID();
          await decision(candidate, action!, id, reason!);
          await decision(candidate, action!, id, reason!);
          const rows =
            await owner.client`select * from app.approval_notifications where event_key=${id}`;
          assert.equal(rows.length, 1);
          const notice = String(rows[0]!["id"]),
            count = provider.messages.length;
          assert.equal(await deliverApprovalNotifications(worker, email, origin, 1, notice), 1);
          assert.equal(provider.messages[count]!.to, candidate + "@example.invalid");
          assert.ok(!provider.messages[count]!.text.includes("Internal"));
          assert.equal(
            (await notices(candidate)).find((n) => n["id"] === notice)!["delivered_at"] !== null,
            true,
          );
          assert.equal(rows[0]!["kind"], kind);
        },
      );
    }
    await t.test(
      "neutral rejection, worker failure, stable sender snapshot and retry key",
      async () => {
        const who = await seed("rejected", "pending"),
          id = randomUUID();
        await decision(who, "reject", id, "Private reason must never appear in email");
        const row = (
          await owner.client`select * from app.approval_notifications where event_key=${id}`
        )[0]!;
        const notice = String(row["id"]);
        provider.fail = true;
        assert.equal(await deliverApprovalNotifications(worker, email, origin, 1, notice), 0);
        const [failed] =
          await owner.client`select * from app.approval_notifications where id=${notice}`;
        assert.equal(failed!["last_error"], "delivery_failed");
        assert.equal(failed!["attempts"], 1);
        assert.equal(failed!["delivered_at"], null);
        assert.equal(
          (
            await owner.client`select approval_status from app.clergy_profiles where user_id=${who}`
          )[0]!["approval_status"],
          "rejected",
        );
        await owner.client`update app.approval_notifications set available_at=now() where id=${notice}`;
        provider.fail = false;
        assert.equal(await deliverApprovalNotifications(worker, email, origin, 1, notice), 1);
        const mail = provider.messages.at(-1)!;
        assert.equal(mail.key, `approval:${notice}`);
        assert.equal(mail.from, failed!["sender_from"]);
        assert.ok(!mail.text.includes("Private reason"));
        assert.equal(mail.subject, "An update on your clergy registration");
      },
    );
    await t.test(
      "runtime cannot inspect mail tables or execute worker/internal helper functions",
      async () => {
        await assert.rejects(runtime.client`select * from app.approval_notifications`, {
          code: "42501",
        });
        await assert.rejects(
          runtime.client`select app.claim_notification('approval',${randomUUID()},null)`,
          { code: "42501" },
        );
        await assert.rejects(
          worker.client`select app.notification_eligible_before_phase42('approval',${alertId})`,
          { code: "42501" },
        );
      },
    );
  } finally {
    await Promise.all([owner.close(), runtime.close(), worker.close()]);
  }
});
