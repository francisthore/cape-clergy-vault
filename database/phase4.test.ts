import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";
import { connectLocalScanner } from "./scanner.server.ts";
import { connectLocalNotifications } from "./notifications.server.ts";
import { consumeLimit } from "../src/lib/security/rate-limit.server.ts";
import { deliverApprovalNotifications } from "../src/lib/approvals/notifications.server.ts";
import {
  EmailService,
  TestEmailProvider,
  configuredEmail,
} from "../src/lib/email/service.server.ts";

test("Phase 4 actual restricted worker and shared limiter acceptance", async (t) => {
  const owner = await connectLocalDatabase(),
    runtime = await connectLocalRuntime(),
    scanner = await connectLocalScanner(),
    worker = await connectLocalNotifications();
  const id = "phase4-" + randomUUID(),
    secret = randomUUID(),
    origin = "http://localhost:3000",
    jobs: string[] = [],
    buckets: string[] = [];
  async function job() {
    const [r] =
      await owner.client`insert into app.approval_notifications(event_key,user_id,kind) values(${randomUUID()},${id},'approved') returning id`;
    jobs.push(String(r!["id"]));
    return jobs.at(-1)!;
  }
  async function claim(n: string, lease = randomUUID()) {
    const [r] =
      await worker.client`select app.claim_notification('approval',${lease},${n}) as data`;
    return { data: r!["data"], lease };
  }
  const mail = new EmailService(new TestEmailProvider(), {
    origin,
    from: "Fixture <fixture@example.invalid>",
  });
  try {
    await owner.client`insert into auth.users(id,name,email,email_verified) values(${id},'Disposable Phase 4',${id + "@example.invalid"},true)`;
    await owner.client`insert into app.clergy_profiles(user_id,full_name,approval_status) values(${id},'Disposable Phase 4','approved')`;
    await t.test(
      "web and scanner cannot claim notifications, including forged actor settings",
      async () => {
        for (const c of [runtime, scanner])
          await assert.rejects(
            c.client.begin(async (tx) => {
              await tx`select set_config('cape.user_id',${id},true)`;
              await tx`select app.claim_notification('approval',${randomUUID()},null)`;
            }),
            { code: "42501" },
          );
      },
    );
    const attempts = [
      ["approval decisions", "update app.clergy_profiles set approval_status='approved'"],
      [
        "reviewer grants",
        "insert into app.role_assignments(user_id,role) values ('unavailable','reviewer')",
      ],
      ["sender settings", "update app.email_settings set transactional_enabled=true"],
      ["auth CRUD", "select * from auth.users"],
      ["arbitrary private documents", "select * from app.documents"],
      ["DDL", "create table public.phase4_forbidden(id int)"],
      ["immutable audit deletion", "delete from app.audit_events"],
      ["review mutation", "update app.review_decisions set notes='forbidden'"],
    ];
    for (const [name, sql] of attempts)
      await t.test(`worker denied ${name}`, async () => {
        await assert.rejects(worker.client.unsafe(sql!), { code: "42501" });
      });
    await t.test("worker cannot call protected business/operator/scanner functions", async () => {
      const [r] =
        await owner.client`select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='app' and has_function_privilege('cape_clergy_notifications',p.oid,'EXECUTE')`;
      assert.equal(r!["n"], 5);
      await assert.rejects(
        worker.client`select app.consume_rate_limit('login',${"a".repeat(64)})`,
        { code: "42501" },
      );
    });
    await t.test(
      "concurrent claims are disjoint and unfinished leases recover with stale completions fenced",
      async () => {
        const a = await job(),
          b = await job();
        const x = randomUUID(),
          y = randomUUID();
        const pair = await Promise.all([
          worker.client`select app.claim_notification('approval',${x},null) as data`,
          worker.client`select app.claim_notification('approval',${y},null) as data`,
        ]);
        const first = pair[0]![0]!["data"].id,
          second = pair[1]![0]!["data"].id;
        assert.notEqual(first, second);
        await owner.client`update app.approval_notifications set available_at=now()-interval '1 second' where id=${first}`;
        const reclaimed = await claim(first);
        assert.equal(reclaimed.data.id, first);
        const [stale] =
          await worker.client`select app.finish_notification('approval',${first},${x},true) as done`;
        assert.equal(stale!["done"], false);
        assert.ok(a && b);
      },
    );
    await t.test("retry ceiling survives a crash on the final lease", async () => {
      const n = await job();
      await owner.client`update app.approval_notifications set attempts=7 where id=${n}`;
      assert.ok((await claim(n)).data);
      await owner.client`update app.approval_notifications set available_at=now()-interval '1 second' where id=${n}`;
      assert.equal((await claim(n)).data, null);
    });
    await t.test(
      "provider failures retain immutable business state and stable payload/key",
      async () => {
        const n = await job(),
          messages: unknown[] = [];
        const failing = new EmailService(
          {
            send: async (m) => {
              messages.push(m);
              throw Error("synthetic outage");
            },
          },
          { origin, from: "Fixture <fixture@example.invalid>" },
        );
        assert.equal(await deliverApprovalNotifications(worker, failing, origin, 1, n), 0);
        await owner.client`update app.approval_notifications set available_at=now() where id=${n}`;
        assert.equal(await deliverApprovalNotifications(worker, mail, origin, 1, n), 1);
        assert.deepEqual(messages[0], (mail.provider as TestEmailProvider).messages[0]);
        const [r] =
          await owner.client`select approval_status from app.clergy_profiles where user_id=${id}`;
        assert.equal(r!["approval_status"], "approved");
      },
    );
    await t.test(
      "missing encryption material and unavailable sender configuration cannot deliver",
      async () => {
        assert.throws(
          () =>
            configuredEmail(origin, { EMAIL_PROVIDER: "resend", EMAIL_DOMAIN_VERIFIED: "true" }),
          /credentials/,
        );
        const n = await job();
        const disabled = new EmailService(
          new TestEmailProvider(),
          { origin, from: "Fixture <fixture@example.invalid>" },
          async () => ({
            from: "Fixture <fixture@example.invalid>",
            transactionalEnabled: false,
            notificationsEnabled: false,
          }),
        );
        assert.equal(await deliverApprovalNotifications(worker, disabled, origin, 1, n), 0);
        const [r] =
          await owner.client`select delivered_at,last_error from app.approval_notifications where id=${n}`;
        assert.equal(r!["delivered_at"], null);
        assert.equal(r!["last_error"], "delivery_failed");
      },
    );
    await t.test("shared concurrent limits and legitimate expiry recovery", async () => {
      const subject = randomUUID(),
        digest = createHmac("sha256", secret)
          .update("register:" + subject)
          .digest("hex");
      buckets.push("register:" + digest);
      const results = await Promise.all(
        Array.from({ length: 30 }, () => consumeLimit(runtime.client, secret, "register", subject)),
      );
      assert.equal(results.filter((r) => r.allowed).length, 10);
      const other = await connectLocalRuntime();
      try {
        assert.equal(
          (await consumeLimit(other.client, secret, "register", subject)).allowed,
          false,
        );
      } finally {
        await other.close();
      }
      await owner.client`update app.rate_limits set expires_at=now()-interval '1 second' where key=${"register:" + digest}`;
      assert.equal((await consumeLimit(runtime.client, secret, "register", subject)).allowed, true);
    });
    await t.test("two actual processes share one durable window", async () => {
      const subject = randomUUID(),
        digest = createHmac("sha256", secret)
          .update("register:" + subject)
          .digest("hex");
      buckets.push("register:" + digest);
      const code = `import {connectLocalRuntime} from './database/runtime.server.ts';import {consumeLimit} from './src/lib/security/rate-limit.server.ts';const c=await connectLocalRuntime();try{let allowed=0;for(let i=0;i<10;i++)if((await consumeLimit(c.client,process.env.CAPE_FIXTURE_SECRET,'register',process.env.CAPE_FIXTURE_SUBJECT)).allowed)allowed++;console.log(JSON.stringify({event:"fixture.limit_result",allowed}));}finally{await c.close()}`;
      function child() {
        return new Promise<number>((resolve, reject) => {
          const p = spawn(process.execPath, ["--input-type=module", "-e", code], {
            env: { ...process.env, CAPE_FIXTURE_SECRET: secret, CAPE_FIXTURE_SUBJECT: subject },
            stdio: ["ignore", "pipe", "pipe"],
          });
          let output = "";
          p.stdout.on("data", (b) => (output += b));
          p.on("error", reject);
          p.on("exit", (c) =>
            c === 0
              ? (() => {
                  const records = output
                    .trim()
                    .split("\n")
                    .map((line) => JSON.parse(line))
                    .filter((row) => row.event === "fixture.limit_result");
                  assert.equal(records.length, 1);
                  resolve(Number(records[0].allowed));
                })()
              : reject(Error("Limiter child failed")),
          );
        });
      }
      const results = await Promise.all([child(), child()]);
      assert.equal(
        results.reduce((a, b) => a + b),
        10,
      );
    });
  } finally {
    await owner.client.begin(async (tx) => {
      await tx`delete from app.rate_limits where key=any(${buckets})`;
      await tx`delete from app.approval_notifications where user_id=${id}`;
      await tx`delete from app.clergy_profiles where user_id=${id}`;
      await tx`delete from auth.users where id=${id}`;
    });
    await Promise.all([owner.close(), runtime.close(), scanner.close(), worker.close()]);
  }
});
