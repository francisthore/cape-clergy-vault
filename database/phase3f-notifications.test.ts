import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";
import { deliverReviewerNotifications } from "../src/lib/reviews/notifications.server.ts";
import { EmailService, TestEmailProvider } from "../src/lib/email/service.server.ts";

test("Phase 3F exact assignment notification regression", async (t) => {
  const owner = await connectLocalDatabase(),
    runtime = await connectLocalRuntime();
  const prefix = `p3f-notice-${randomUUID()}`,
    ids = [prefix + "-author", prefix + "-reviewer", prefix + "-other"];
  const submission = randomUUID(),
    origin = "http://localhost:3000";
  const provider = new TestEmailProvider(),
    email = new EmailService(provider, { origin, from: "Fixture <fixture@example.invalid>" });
  const allowed = (notice: string, who = ids[1]!) =>
    runtime.client.begin(async (tx) => {
      await tx`select set_config('cape.user_id',${who},true)`;
      const [r] = await tx`select app.assignment_notification_allowed(${notice}) as allowed`;
      return r!["allowed"];
    });
  async function assignment(revision = 1, who = ids[1]!) {
    const [a] =
      await owner.client`insert into app.reviewer_assignments(submission_id,revision,reviewer_id,assigned_by) values(${submission},${revision},${who},session_user) returning id`;
    const [n] =
      await owner.client`insert into app.reviewer_notifications(event_key,user_id,kind,submission_id,assignment_id) values(${randomUUID()},${who},'review_assigned',${submission},${a!["id"]}) returning id`;
    return { a: String(a!["id"]), n: String(n!["id"]) };
  }
  try {
    for (const id of ids) {
      await owner.client`insert into auth.users(id,name,email,email_verified) values(${id},'Notification fixture',${id + "@example.invalid"},true)`;
      await owner.client`insert into app.clergy_profiles(user_id,full_name,approval_status) values(${id},'Notification fixture','approved')`;
      await owner.client`insert into app.role_assignments(user_id,role) values(${id},'clergy'),(${id},'reviewer')`;
      await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${id},'repository-v1','repository','accepted')`;
    }
    await owner.client`insert into app.submissions(id,owner_id,title,status) values(${submission},${ids[0]!},'Disposable notification fixture','submitted')`;
    const old = await assignment();
    await t.test("correct exact active assignment permits delivery", async () =>
      assert.equal(await allowed(old.n), true),
    );
    await t.test("revocation cancels and audits pending notification", async () => {
      await owner.client`update app.reviewer_assignments set status='revoked',revoked_at=now() where id=${old.a}`;
      assert.equal(await allowed(old.n), false);
      const [r] =
        await owner.client`select cancelled_at from app.reviewer_notifications where id=${old.n}`;
      assert.ok(r!["cancelled_at"]);
      const [audit] =
        await owner.client`select count(*)::int as n from app.audit_events where correlation_id=${old.n} and action='reviewer.notification_cancelled'`;
      assert.equal(audit!["n"], 1);
    });
    const stale = await assignment();
    await owner.client`update app.submissions set revision=2 where id=${submission}`;
    const current = await assignment(2);
    await t.test(
      "old revision cannot deliver; newer assignment cannot validate older event",
      async () => {
        assert.equal(await allowed(stale.n), false);
        assert.equal(await allowed(current.n), true);
        // Simulate preserved legacy pending event to exercise predicate independently of cancellation trigger.
        await owner.client`update app.reviewer_notifications set cancelled_at=null where id=${stale.n}`;
        assert.equal(await allowed(stale.n), false);
        assert.equal(
          await deliverReviewerNotifications(owner, email, origin, "fixture", 1, stale.n),
          0,
        );
      },
    );
    await t.test("wrong recipient pairing and wrong actor are rejected", async () => {
      assert.equal(await allowed(current.n, ids[2]!), false);
      await owner.client`update app.reviewer_notifications set user_id=${ids[2]!} where id=${current.n}`;
      assert.equal(await allowed(current.n, ids[2]!), false);
      await owner.client`update app.reviewer_notifications set user_id=${ids[1]!} where id=${current.n}`;
    });
    await t.test("live reviewer role revocation prevents later send", async () => {
      await owner.client`update app.role_assignments set revoked_at=now() where user_id=${ids[1]!} and role='reviewer'`;
      assert.equal(await allowed(current.n), false);
      assert.equal(
        await deliverReviewerNotifications(owner, email, origin, "fixture", 1, current.n),
        0,
      );
    });
    await t.test("delivery retry retains stable key and payload", async () => {
      const item = await assignment(2, ids[2]!);
      const failing = new EmailService(
        {
          send: async () => {
            throw Error("fixture unavailable");
          },
        },
        { origin, from: "Fixture <fixture@example.invalid>" },
      );
      assert.equal(
        await deliverReviewerNotifications(owner, failing, origin, "fixture", 1, item.n),
        0,
      );
      const [r] =
        await owner.client`select attempts,delivered_at,sender_from from app.reviewer_notifications where id=${item.n}`;
      assert.equal(r!["attempts"], 1);
      assert.equal(r!["delivered_at"], null);
      assert.ok(r!["sender_from"]);
      await owner.client`update app.reviewer_notifications set available_at=now() where id=${item.n}`;
      assert.equal(
        await deliverReviewerNotifications(owner, email, origin, "fixture", 1, item.n),
        1,
      );
      assert.equal(provider.messages.length, 1);
    });
    await t.test(
      "revocation during payload preparation cancels before provider submission",
      async () => {
        await owner.client`update app.submissions set revision=3 where id=${submission}`;
        const item = await assignment(3, ids[2]!);
        const cancelling = new EmailService(
          provider,
          { origin, from: "Fixture <fixture@example.invalid>" },
          async () => {
            await owner.client`update app.reviewer_assignments set status='revoked',revoked_at=now() where id=${item.a}`;
            return {
              from: "Fixture <fixture@example.invalid>",
              transactionalEnabled: true,
              notificationsEnabled: true,
            };
          },
        );
        assert.equal(
          await deliverReviewerNotifications(owner, cancelling, origin, "fixture", 1, item.n),
          0,
        );
        assert.equal(provider.messages.length, 1);
      },
    );
    await t.test(
      "revocation after provider submission retains cancellation and live-link denial",
      async () => {
        const item = await assignment(3, ids[2]!);
        let accepted = 0;
        const inFlight = new EmailService(
          {
            send: async () => {
              accepted++;
              await owner.client`update app.reviewer_assignments set status='revoked',revoked_at=now() where id=${item.a}`;
            },
          },
          { origin, from: "Fixture <fixture@example.invalid>" },
        );
        assert.equal(
          await deliverReviewerNotifications(owner, inFlight, origin, "fixture", 1, item.n),
          0,
        );
        assert.equal(accepted, 1);
        assert.equal(await allowed(item.n, ids[2]!), false);
        const [r] =
          await owner.client`select cancelled_at from app.reviewer_notifications where id=${item.n}`;
        assert.ok(r!["cancelled_at"]);
      },
    );
    await t.test(
      "mailbox changes cancel an actionable retry without retargeting its stable payload",
      async () => {
        const item = await assignment(3, ids[2]!);
        const failing = new EmailService(
          {
            send: async () => {
              throw Error("fixture unavailable");
            },
          },
          { origin, from: "Fixture <fixture@example.invalid>" },
        );
        await deliverReviewerNotifications(owner, failing, origin, "fixture", 1, item.n);
        const [before] =
          await owner.client`select recipient_email from app.reviewer_notifications where id=${item.n}`;
        await owner.client`update auth.users set email=${prefix + "-replacement@example.invalid"} where id=${ids[2]!}`;
        await owner.client`update app.reviewer_notifications set available_at=now() where id=${item.n}`;
        assert.equal(
          await deliverReviewerNotifications(owner, email, origin, "fixture", 1, item.n),
          0,
        );
        const [after] =
          await owner.client`select recipient_email,cancelled_at from app.reviewer_notifications where id=${item.n}`;
        assert.equal(after!["recipient_email"], before!["recipient_email"]);
        assert.ok(after!["cancelled_at"]);
      },
    );
  } finally {
    await owner.client.begin(async (tx) => {
      await tx`delete from app.reviewer_notifications where submission_id=${submission}`;
      await tx`delete from app.reviewer_assignments where submission_id=${submission}`;
      for (const table of ["audit_events", "popia_consent_events"]) {
        await tx.unsafe(`alter table app.${table} disable trigger user`);
        if (table === "audit_events")
          await tx`delete from app.audit_events where target_user_id=any(${ids}) or submission_id=${submission}`;
        else await tx`delete from app.popia_consent_events where user_id=any(${ids})`;
        await tx.unsafe(`alter table app.${table} enable trigger user`);
      }
      await tx`delete from app.submissions where id=${submission}`;
      await tx`delete from app.role_assignments where user_id=any(${ids})`;
      await tx`delete from app.clergy_profiles where user_id=any(${ids})`;
      await tx`delete from auth.users where id=any(${ids})`;
    });
    await runtime.close();
    await owner.close();
  }
});
