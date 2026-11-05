import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { test } from "node:test";
import { hashPassword } from "better-auth/crypto";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";
import { createAuthService } from "../src/lib/auth/service.server.ts";
import { createApprovalService } from "../src/lib/approvals/service.server.ts";
import { deliverApprovalNotifications } from "../src/lib/approvals/notifications.server.ts";
import { EmailService, TestEmailProvider } from "../src/lib/email/service.server.ts";

test("Phase 3B: real restricted-runtime approval authorization and consistency", async (t) => {
  const owner = await connectLocalDatabase();
  const runtime = await connectLocalRuntime();
  const prefix = `phase3b-${randomUUID()}`;
  const ids = Array.from({ length: 7 }, (_, n) => `${prefix}-${n}`);
  const [actor, target, ordinary, unverified, second, pending, rejected] = ids as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const origin = "http://localhost:3000";
  const password = "Phase 3B disposable unique passphrase";
  const provider = new TestEmailProvider();
  const email = new EmailService(provider, { from: "Local <local@example.invalid>", origin });
  const auth = createAuthService(runtime, email, {
    secret: randomBytes(32).toString("hex"),
    baseURL: origin,
  });
  const service = createApprovalService(auth, origin);
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("External network forbidden in tests");
  };
  const cookies = new Map<string, string>();
  const request = (id?: string, body?: unknown, query = "") =>
    service.handle(
      new Request(`${origin}/api/registrations${query}`, {
        method: body ? "POST" : "GET",
        headers: {
          origin,
          cookie: id ? (cookies.get(id) ?? "") : "",
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  const decision = (
    id: string,
    action: string,
    reason = "Fixture decision reason",
    requestId = randomUUID(),
  ) => ({ targetId: id, action, reason, requestId });
  const asRuntime = async (
    id: string | null,
    fn: (tx: import("postgres").TransactionSql) => Promise<unknown>,
  ) =>
    runtime.client.begin(async (tx) => {
      if (id) await tx`select set_config('cape.user_id',${id},true)`;
      return fn(tx);
    });
  try {
    const hash = await hashPassword(password);
    for (const id of ids) {
      await owner.client`insert into auth.users(id,name,email,email_verified) values(${id},'Disposable clergy',${id + "@example.invalid"},${id !== unverified})`;
      await owner.client`insert into auth.accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) values(${randomUUID()},${id},'credential',${id},${hash},now(),now())`;
      await owner.client`insert into app.clergy_profiles(user_id,full_name,title,parish,approval_status) values(${id},'Disposable clergy','Rev.','Test parish',${[actor, ordinary, second].includes(id) ? "approved" : id === rejected ? "rejected" : "pending"})`;
      await owner.client`insert into app.role_assignments(user_id,role) values(${id},'clergy')`;
      if (id !== unverified) {
        const response = await auth.handle(
          new Request(`${origin}/api/auth/sign-in/email`, {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: JSON.stringify({ email: id + "@example.invalid", password }),
          }),
        );
        assert.equal(response.status, 200);
        cookies.set(
          id,
          response.headers
            .getSetCookie()
            .map((c) => c.split(";")[0])
            .join("; "),
        );
      }
    }
    await t.test(
      "bootstrap requires exact confirmation and verified identity, grants only approver, and is one-time",
      async () => {
        const rollback = new Error("bootstrap fixture rollback");
        await assert.rejects(
          owner.client.begin(async (tx) => {
            await assert.rejects(
              tx.savepoint(
                async (q) => q`select app.bootstrap_approver(${target},'wrong confirmation')`,
              ),
            );
            await assert.rejects(
              tx.savepoint(
                async (q) =>
                  q`select app.bootstrap_approver(${unverified},${"GRANT APPROVER " + unverified})`,
              ),
            );
            await assert.rejects(
              tx.savepoint(
                async (q) => q`select app.bootstrap_approver('missing','GRANT APPROVER missing')`,
              ),
            );
            await tx`select app.bootstrap_approver(${target},${"GRANT APPROVER " + target})`;
            assert.equal(
              (
                await tx`select approval_status from app.clergy_profiles where user_id=${target}`
              )[0]!["approval_status"],
              "approved",
            );
            assert.deepEqual(
              (
                await tx`select role from app.role_assignments where user_id=${target} order by role::text`
              ).map((r) => r["role"]),
              ["approver", "clergy"],
            );
            assert.equal(
              (
                await tx`select * from app.audit_events where target_user_id=${target} and action='approver.bootstrap'`
              ).length,
              1,
            );
            await assert.rejects(
              tx.savepoint(
                async (q) =>
                  q`select app.bootstrap_approver(${ordinary},${"GRANT APPROVER " + ordinary})`,
              ),
            );
            await assert.rejects(tx.savepoint(async (q) => q`delete from app.approver_bootstrap`));
            throw rollback;
          }),
          (e) => e === rollback,
        );
        assert.equal((await owner.client`select * from app.approver_bootstrap`).length, 0);
        assert.equal(
          (
            await auth.handle(
              new Request(`${origin}/api/auth/bootstrap-approver`, {
                method: "POST",
                headers: { origin, "content-type": "application/json" },
                body: "{}",
              }),
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      "registration-received intent requires verified provisioned profile and deduplicates",
      async () => {
        assert.equal(
          (await owner.client`select * from app.approval_notifications where user_id=${unverified}`)
            .length,
          0,
        );
        await owner.client`update auth.users set email_verified=true where id=${target}`;
        await owner.client`update auth.users set email_verified=true where id=${target}`;
        assert.equal(
          (
            await owner.client`select * from app.approval_notifications where user_id=${target} and kind='pending'`
          ).length,
          1,
        );
      },
    );
    for (const id of [actor, second, pending, rejected])
      await owner.client`insert into app.role_assignments(user_id,role) values(${id},'approver')`;
    await t.test(
      "unauthenticated, ordinary, pending and rejected administration denied",
      async () => {
        for (const id of [undefined, ordinary, pending, rejected])
          assert.equal((await request(id)).status, 403);
        assert.equal((await request(rejected, decision(target, "approve"))).status, 403);
        assert.equal((await request(pending, decision(target, "approve"))).status, 403);
      },
    );
    await t.test(
      "approver sees minimal pending list, filtering and details with no-store",
      async () => {
        const response = await request(actor);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        const result = await response.json();
        assert.ok(result.rows.some((r: { user_id: string }) => r.user_id === target));
        assert.ok(
          result.rows.every(
            (r: Record<string, unknown>) =>
              r["approval_status"] === "pending" && !("phone" in r) && !("password" in r),
          ),
        );
        const detail = await request(actor, undefined, `?id=${target}`);
        assert.equal(detail.status, 200);
        assert.equal((await request(actor, undefined, "?page=0")).status, 400);
        assert.equal(
          (await request(actor, undefined, "?status=approved&search=no-match")).status,
          200,
        );
      },
    );
    await t.test(
      "server pagination returns bounded pages and filters across the full result set",
      async () => {
        for (let n = 0; n < 21; n++) {
          const id = `${prefix}-page-${n}`;
          ids.push(id);
          await owner.client`insert into auth.users(id,name,email) values(${id},'Pagination fixture',${id + "@example.invalid"})`;
          await owner.client`insert into app.clergy_profiles(user_id,full_name) values(${id},'Pagination fixture')`;
        }
        const query = `?status=all&search=${encodeURIComponent(prefix)}`;
        const first = await (await request(actor, undefined, query + "&page=1")).json();
        const last = await (await request(actor, undefined, query + "&page=2")).json();
        assert.equal(first.total, 28);
        assert.equal(first.rows.length, 20);
        assert.equal(last.rows.length, 8);
        assert.equal(
          new Set([...first.rows, ...last.rows].map((r: { user_id: string }) => r.user_id)).size,
          28,
        );
      },
    );
    await t.test(
      "self approval, forged actor/role, missing reason, unverified approval and unsafe origin denied",
      async () => {
        assert.equal((await request(actor, decision(actor, "approve"))).status, 409);
        assert.equal(
          (await request(actor, { ...decision(target, "approve"), actorId: second })).status,
          400,
        );
        assert.equal(
          (await request(actor, { ...decision(target, "approve"), role: "admin" })).status,
          400,
        );
        assert.equal((await request(actor, decision(target, "reject", ""))).status, 409);
        assert.equal((await request(actor, decision(unverified, "approve"))).status, 409);
        assert.equal(
          (
            await service.handle(
              new Request(`${origin}/api/registrations`, {
                method: "POST",
                body: JSON.stringify(decision(target, "approve")),
                headers: { origin: "https://evil.invalid", cookie: cookies.get(actor)! },
              }),
            )
          ).status,
          403,
        );
        assert.equal((await request(actor, undefined, "?actorId=forged")).status, 400);
      },
    );
    const approved = decision(target, "approve");
    await t.test(
      "approval atomically records status, history, audit and notification; retry deduplicates",
      async () => {
        assert.equal((await request(actor, approved)).status, 200);
        assert.equal((await request(actor, approved)).status, 200);
        const [row] = await owner.client`select p.approval_status,
        (select count(*)::int from app.account_approval_events where id=${approved.requestId}) as events,
        (select count(*)::int from app.audit_events where correlation_id=${approved.requestId}) as audits,
        (select count(*)::int from app.approval_notifications where event_key=${approved.requestId}) as notifications
        from app.clergy_profiles p where user_id=${target}`;
        assert.deepEqual(
          { ...row },
          { approval_status: "approved", events: 1, audits: 1, notifications: 1 },
        );
        assert.equal((await request(actor, decision(target, "approve"))).status, 409);
        assert.equal((await request(actor, { ...approved, reason: "Changed intent" })).status, 409);
        assert.equal(
          (await owner.client`select role from app.role_assignments where user_id=${target}`)
            .length,
          1,
        );
      },
    );
    await t.test(
      "history is immutable even for owner; runtime cannot mutate status, roles or intents",
      async () => {
        await assert.rejects(
          owner.client`update app.account_approval_events set reason='tampered' where id=${approved.requestId}`,
        );
        await assert.rejects(
          owner.client`delete from app.account_approval_events where id=${approved.requestId}`,
        );
        await assert.rejects(
          asRuntime(
            actor,
            async (tx) =>
              tx`update app.clergy_profiles set approval_status='approved' where user_id=${pending}`,
          ),
        );
        await assert.rejects(
          asRuntime(
            actor,
            async (tx) =>
              tx`insert into app.role_assignments(user_id,role) values(${actor},'reviewer')`,
          ),
        );
        await assert.rejects(runtime.client`select * from app.approval_notifications`);
        await assert.rejects(
          runtime.client`select app.bootstrap_approver(${ordinary},${"GRANT APPROVER " + ordinary})`,
        );
        await assert.rejects(
          asRuntime(null, async (tx) => tx`select app.registration_list('pending','',1)`),
        );
      },
    );
    await t.test("conflicting concurrent decisions have exactly one winner", async () => {
      const a = decision(pending, "approve"),
        b = decision(pending, "reject");
      const responses = await Promise.all([request(actor, a), request(second, b)]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      assert.equal(
        (await owner.client`select * from app.account_approval_events where user_id=${pending}`)
          .length,
        1,
      );
    });
    await t.test("rejection records reason and cannot be reconsidered implicitly", async () => {
      const response = await request(
        actor,
        decision(unverified, "reject", "Registration could not be confirmed"),
      );
      assert.equal(response.status, 200);
      const [event] =
        await owner.client`select reason from app.account_approval_events where user_id=${unverified}`;
      assert.equal(event!["reason"], "Registration could not be confirmed");
      assert.equal((await request(actor, decision(unverified, "approve"))).status, 409);
    });
    await t.test(
      "suspension revokes sessions, denies live approvers, reactivation enforces verification and clergy role",
      async () => {
        assert.equal((await request(actor, decision(second, "suspend"))).status, 200);
        assert.equal(
          (await owner.client`select * from auth.sessions where user_id=${second}`).length,
          0,
        );
        assert.equal((await request(second, decision(target, "suspend"))).status, 403);
        await owner.client`update auth.users set email_verified=false where id=${second}`;
        assert.equal((await request(actor, decision(second, "reactivate"))).status, 409);
        await owner.client`update auth.users set email_verified=true where id=${second}`;
        await owner.client`update app.role_assignments set revoked_at=now() where user_id=${second} and role='clergy'`;
        assert.equal((await request(actor, decision(second, "reactivate"))).status, 409);
        await owner.client`update app.role_assignments set revoked_at=null where user_id=${second} and role='clergy'`;
        assert.equal((await request(actor, decision(second, "reactivate"))).status, 200);
        assert.equal(
          (await owner.client`select * from auth.sessions where user_id=${second}`).length,
          0,
        );
      },
    );
    await t.test("live permission revocation takes effect on subsequent operations", async () => {
      await owner.client`update app.role_assignments set revoked_at=now() where user_id=${actor} and role='approver'`;
      assert.equal((await request(actor)).status, 403);
      assert.equal((await request(actor, decision(target, "suspend"))).status, 403);
      await owner.client`update app.role_assignments set revoked_at=null where user_id=${actor} and role='approver'`;
    });
    await t.test(
      "approval capability grants no reviewer, private chat or confidential submission access",
      async () => {
        await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${actor},'repository-v1','repository','accepted'),(${actor},'private-chat-v1','private_chat','accepted'),(${target},'private-chat-v1','private_chat','accepted')`;
        await owner.client`insert into app.submissions(owner_id,title,confidential) values(${target},'Private fixture',true)`;
        await owner.client`insert into app.chat_messages(id,owner_id,sender_id,body) values(${randomUUID()},${target},${target},'Private fixture')`;
        await asRuntime(actor, async (tx) => {
          assert.equal(
            (await tx`select app.is_reviewer() as r,app.is_admin() as a`)[0]!["r"],
            false,
          );
          assert.equal(
            (await tx`select * from app.submissions where owner_id=${target}`).length,
            0,
          );
          assert.equal(
            (await tx`select * from app.chat_messages where owner_id=${target}`).length,
            0,
          );
        });
      },
    );
    await t.test(
      "transaction rollback leaves no false success events or notification intent",
      async () => {
        const rollback = new Error("rollback fixture");
        const key = randomUUID();
        await assert.rejects(
          runtime.client.begin(async (tx) => {
            await tx`select set_config('cape.user_id',${actor},true)`;
            await tx`select app.decide_registration(${target},'suspend','Rollback fixture',${key})`;
            throw rollback;
          }),
          (e) => e === rollback,
        );
        assert.equal(
          (await owner.client`select * from app.account_approval_events where id=${key}`).length,
          0,
        );
        assert.equal(
          (await owner.client`select * from app.audit_events where correlation_id=${key}`).length,
          0,
        );
        assert.equal(
          (await owner.client`select * from app.approval_notifications where event_key=${key}`)
            .length,
          0,
        );
        assert.equal(
          (
            await owner.client`select approval_status from app.clergy_profiles where user_id=${target}`
          )[0]!["approval_status"],
          "approved",
        );
      },
    );
    await t.test(
      "durable mail failure preserves decisions, bounded retry and stable delivery idempotency",
      async () => {
        const [notification] =
          await owner.client`select id from app.approval_notifications where event_key=${approved.requestId}`;
        const id = String(notification!["id"]);
        provider.fail = true;
        assert.equal(await deliverApprovalNotifications(owner, email, origin, 1, id), 0);
        const [failed] =
          await owner.client`select attempts,last_error,delivered_at from app.approval_notifications where id=${id}`;
        assert.equal(failed!["attempts"], 1);
        assert.equal(failed!["last_error"], "delivery_failed");
        assert.equal(failed!["delivered_at"], null);
        assert.equal(
          (
            await owner.client`select approval_status from app.clergy_profiles where user_id=${target}`
          )[0]!["approval_status"],
          "approved",
        );
        provider.fail = false;
        await owner.client`update app.approval_notifications set available_at=now() where id=${id}`;
        assert.equal(await deliverApprovalNotifications(owner, email, origin, 1, id), 1);
        assert.equal(await deliverApprovalNotifications(owner, email, origin, 1, id), 0);
        assert.equal(provider.messages.length, 1);
        assert.equal(provider.messages[0]!.key, `approval:${id}`);
        assert.ok(provider.messages[0]!.html && provider.messages[0]!.text);
      },
    );
    await t.test("worker lease recovery, concurrent claims and attempt exhaustion", async () => {
      const [row] =
        await owner.client`select id from app.approval_notifications where user_id=${target} and kind='pending'`;
      const id = String(row!["id"]);
      await owner.client`update app.approval_notifications set lease_token=${randomUUID()},available_at=now()+interval '5 minutes' where id=${id}`;
      assert.equal(await deliverApprovalNotifications(owner, email, origin, 1, id), 0);
      await owner.client`update app.approval_notifications set available_at=now()-interval '1 second' where id=${id}`;
      const before = provider.messages.length;
      assert.equal(
        (
          await Promise.all([
            deliverApprovalNotifications(owner, email, origin, 1, id),
            deliverApprovalNotifications(owner, email, origin, 1, id),
          ])
        ).reduce((a, b) => a + b, 0),
        1,
      );
      assert.equal(provider.messages.length, before + 1);
      await owner.client`update app.approval_notifications set delivered_at=null,attempts=8,available_at=now() where id=${id}`;
      assert.equal(await deliverApprovalNotifications(owner, email, origin, 1, id), 0);
    });
  } finally {
    globalThis.fetch = fetchOriginal;
    await owner.client.begin(async (tx) => {
      for (const table of [
        "audit_events",
        "account_approval_events",
        "popia_consent_events",
        "chat_messages",
      ])
        await tx.unsafe(`alter table app.${table} disable trigger user`);
      await tx`delete from app.approval_notifications where user_id=any(${ids})`;
      await tx`delete from app.audit_events where actor_id=any(${ids})`;
      await tx`delete from app.account_approval_events where user_id=any(${ids})`;
      await tx`delete from app.popia_consent_events where user_id=any(${ids})`;
      await tx`delete from app.chat_messages where owner_id=any(${ids})`;
      await tx`delete from app.submissions where owner_id=any(${ids})`;
      await tx`delete from app.role_assignments where user_id=any(${ids})`;
      await tx`delete from app.clergy_profiles where user_id=any(${ids})`;
      await tx`delete from auth.users where id=any(${ids})`;
      for (const table of [
        "audit_events",
        "account_approval_events",
        "popia_consent_events",
        "chat_messages",
      ])
        await tx.unsafe(`alter table app.${table} enable trigger user`);
    });
    await runtime.close();
    await owner.close();
  }
});
