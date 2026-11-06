import { scanTestDocument, cleanTestScanRows } from "./test-scanning.ts";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { test } from "node:test";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";
import { createAuthService } from "../src/lib/auth/service.server.ts";
import {
  configuredEmail,
  EmailService,
  TestEmailProvider,
} from "../src/lib/email/service.server.ts";
import { resolveEmailSettings } from "../src/lib/settings/email.server.ts";
import { createSettingsService } from "../src/lib/settings/service.server.ts";
import { createSubmissionService } from "../src/lib/submissions/service.server.ts";
import { createApprovalService } from "../src/lib/approvals/service.server.ts";
import { createDocumentService } from "../src/lib/documents/service.server.ts";
import { LocalPrivateStorageProvider } from "../src/lib/documents/storage.server.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliverApprovalNotifications } from "../src/lib/approvals/notifications.server.ts";
import { hashPassword } from "better-auth/crypto";

test("Phase 3D restricted runtime", async (t) => {
  const owner = await connectLocalDatabase(),
    runtime = await connectLocalRuntime();
  const prefix = `phase3d-${randomUUID()}`;
  const names = ["manager", "clergy", "approver", "reviewer", "pending", "unverified"];
  const ids = names.map((n) => `${prefix}-${n}`);
  const id = (name: string) => `${prefix}-${name}`;
  const origin = "http://localhost:3000",
    password = "Disposable Phase 3D fixture passphrase";
  const provider = new TestEmailProvider();
  const dynamic = new EmailService(
    provider,
    { origin, from: "unused@example.invalid" },
    async () => {
      const s = await resolveEmailSettings(runtime.client);
      return {
        from: `${s.displayName} <${s.fromEmail}>`,
        replyTo: s.replyTo,
        transactionalEnabled: true,
        notificationsEnabled: true,
      };
    },
  );
  const auth = createAuthService(runtime, dynamic, {
    baseURL: origin,
    secret: randomBytes(32).toString("hex"),
  });
  const root = await mkdtemp(join(tmpdir(), "cape-phase3d-"));
  const storage = new LocalPrivateStorageProvider(root);
  const documents = createDocumentService(auth, storage, origin);
  const submissions = createSubmissionService(auth, origin);
  const approvals = createApprovalService(auth, origin);
  const settings = createSettingsService(auth, dynamic, origin, "captured");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("No external network in Phase 3D tests");
  };
  const [initial] = await owner.client`select * from app.email_settings`;
  const [domain] =
    await owner.client`select authorized_at from app.email_domains where domain='notifications.ctdiocese.org.za'`;
  const cookies = new Map<string, string>();
  const as = async <T>(name: string, work: (tx: import("postgres").TransactionSql) => Promise<T>) =>
    runtime.client.begin(async (tx) => {
      await tx`select set_config('cape.user_id',${name ? id(name) : ""},true)`;
      return work(tx);
    });
  try {
    const hashed = await hashPassword(password);
    for (const name of names) {
      await owner.client`insert into auth.users(id,name,email,email_verified,created_at,updated_at) values(${id(name)},'Disposable',${name + "-" + prefix + "@example.invalid"},${name !== "unverified"},now(),now())`;
      await owner.client`insert into auth.accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) values(${randomUUID()},${id(name)},'credential',${id(name)},${hashed},now(),now())`;
      await owner.client`insert into app.clergy_profiles(user_id,full_name,approval_status) values(${id(name)},'Disposable',${name === "pending" ? "pending" : "approved"})`;
      await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${id(name)},'repository-v1','repository','accepted')`;
      if (["approver", "reviewer"].includes(name))
        await owner.client`insert into app.role_assignments(user_id,role) values(${id(name)},${name})`;
      if (name !== "unverified") {
        const r = await auth.handle(
          new Request(origin + "/api/auth/sign-in/email", {
            method: "POST",
            headers: { origin, "Content-Type": "application/json" },
            body: JSON.stringify({ email: name + "-" + prefix + "@example.invalid", password }),
          }),
        );
        assert.equal(r.status, 200);
        cookies.set(
          name,
          r.headers
            .getSetCookie()
            .map((v) => v.split(";")[0])
            .join("; "),
        );
      }
    }
    const request = (name: string, body?: unknown) =>
      settings.handle(
        new Request(origin + "/api/settings/email", {
          method: body ? "POST" : "GET",
          headers: { cookie: cookies.get(name) ?? "", origin, "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    await t.test("settings deny all other roles, explicit grant and live revocation", async () => {
      for (const name of ["", "clergy", "approver", "reviewer", "pending", "unverified", "manager"])
        assert.equal((await request(name)).status, 403, name);
      await assert.rejects(
        runtime.client`select app.authorize_settings_manager(${id("manager")},${"GRANT SETTINGS MANAGER " + id("manager")})`,
      );
      await assert.rejects(
        owner.client`select app.authorize_settings_manager(${id("manager")},'wrong')`,
      );
      await owner.client`select app.authorize_settings_manager(${id("manager")},${"GRANT SETTINGS MANAGER " + id("manager")})`;
      assert.equal((await request("manager")).status, 200);
      const [r] = await as(
        "manager",
        (tx) => tx`select app.is_reviewer() as reviewer,app.is_approver() as approver`,
      );
      assert.equal(r!["reviewer"], false);
      assert.equal(r!["approver"], false);
      await owner.client`update app.settings_managers set revoked_at=now() where user_id=${id("manager")}`;
      assert.equal((await request("manager")).status, 403);
      await owner.client`update app.settings_managers set revoked_at=null where user_id=${id("manager")}`;
    });
    await t.test(
      "settings persist, audit, reject invalid domain and stale version, apply without restart",
      async () => {
        await owner.client`update app.email_domains set authorized_at=now() where domain='notifications.ctdiocese.org.za'`;
        const input = {
          version: initial!["version"],
          sendingDomain: "notifications.ctdiocese.org.za",
          displayName: "Changed sender",
          fromEmail: "changed@notifications.ctdiocese.org.za",
          replyTo: "reply@example.invalid",
          transactionalEnabled: false,
          notificationsEnabled: false,
        };
        assert.equal(
          (await request("manager", { ...input, fromEmail: "bad@foreign.invalid" })).status,
          400,
        );
        for (const name of ["clergy", "approver", "reviewer", "pending", ""])
          assert.equal((await request(name, input)).status, 403);
        await owner.client`update auth.sessions set created_at=(now() at time zone 'UTC')-interval '16 minutes' where user_id=${id("manager")}`;
        assert.equal((await request("manager", input)).status, 403);
        await owner.client`update auth.sessions set created_at=(now() at time zone 'UTC') where user_id=${id("manager")}`;
        assert.equal((await request("manager", input)).status, 200);
        assert.equal((await request("manager", input)).status, 409);
        const competing = await Promise.all([
          request("manager", { ...input, version: Number(input.version) + 1 }),
          request("manager", { ...input, version: Number(input.version) + 1 }),
        ]);
        assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
        const effective = await resolveEmailSettings(runtime.client);
        assert.equal(effective.displayName, "Changed sender");
        await dynamic.send("reset", "fixture@example.invalid", origin + "/account");
        assert.match(provider.messages.at(-1)!.from, /Changed sender/);
        const response = await request("manager");
        const body = await response.json();
        assert.equal(body.history[0].actor_id, id("manager"));
        assert.ok(!JSON.stringify(body).includes("RESEND_API_KEY"));
        await assert.rejects(
          as("manager", (tx) => tx`update app.email_settings set display_name='forged'`),
        );
        await assert.rejects(as("manager", (tx) => tx`delete from app.email_settings_history`));
        assert.equal(
          (await request("manager", { action: "test", to: "attacker@example.invalid" })).status,
          400,
        );
        assert.equal((await request("manager", { action: "test" })).status, 200);
        assert.equal(provider.messages.at(-1)!.to, "manager-" + prefix + "@example.invalid");
        assert.equal((await request("manager", { action: "test" })).status, 429);
      },
    );

    await t.test(
      "production resolver honors enabled flags and domain authorization; retries freeze sender",
      async () => {
        const production = configuredEmail(
          origin,
          {
            NODE_ENV: "test",
            EMAIL_PROVIDER: "resend",
            RESEND_API_KEY: "re_disposable_fake",
            EMAIL_DOMAIN_VERIFIED: "true",
          },
          runtime.client,
        );
        await assert.rejects(production.senderSettings("verification"), /EMAIL_DISABLED/);
        await owner.client`update app.email_settings set transactional_enabled=true,notifications_enabled=true where id=1`;
        assert.match((await production.senderSettings("reset")).from, /Changed sender/);
        await owner.client`update app.email_domains set authorized_at=null where domain='notifications.ctdiocese.org.za'`;
        await assert.rejects(
          production.senderSettings("verification"),
          /EMAIL_DOMAIN_UNAUTHORIZED/,
        );
        await owner.client`update app.email_domains set authorized_at=now() where domain='notifications.ctdiocese.org.za'`;
        await owner.client`insert into app.approval_notifications(event_key,user_id,kind) values(${prefix + "-snapshot"},${id("clergy")},'approved')`;
        const [intent] =
          await owner.client`select id from app.approval_notifications where user_id=${id("clergy")} order by created_at,id limit 1`;
        assert.ok(intent);
        provider.fail = true;
        assert.equal(
          await deliverApprovalNotifications(owner, dynamic, origin, 1, String(intent["id"])),
          0,
        );
        await owner.client`update app.email_settings set display_name='Next sender' where id=1`;
        await owner.client`update app.approval_notifications set available_at=now() where id=${intent["id"]}`;
        provider.fail = false;
        assert.equal(
          await deliverApprovalNotifications(owner, dynamic, origin, 1, String(intent["id"])),
          1,
        );
        assert.match(provider.messages.at(-1)!.from, /Changed sender/);
        await dynamic.send("reset", "fixture@example.invalid", origin + "/account");
        assert.match(provider.messages.at(-1)!.from, /Next sender/);
      },
    );
    const subRequest = (name: string, body?: unknown, query = "", repository = false) =>
      submissions.handle(
        new Request(origin + "/api/" + (repository ? "repository" : "submissions") + query, {
          method: body ? "POST" : "GET",
          headers: { cookie: cookies.get(name) ?? "", origin, "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        repository,
      );
    const draft = (kind = "idea", more: Record<string, unknown> = {}) => ({
      action: "save",
      version: 0,
      kind,
      title: "Disposable draft",
      category: "General",
      abstract: "A meaningful description for a disposable test submission.",
      keywords: ["fixture"],
      confidential: false,
      ...more,
    });
    let idea = "",
      document = "";
    await t.test(
      "draft ownership, strict fields, type validation and atomic submission",
      async () => {
        for (const n of ["", "pending", "unverified"])
          assert.equal((await subRequest(n, draft())).status, 403);
        for (const fields of [
          { ownerId: id("manager") },
          { status: "accepted" },
          { title: "" },
          { category: "Invented taxonomy" },
          { keywords: ["x".repeat(61)] },
        ])
          assert.equal((await subRequest("clergy", draft("idea", fields))).status, 400);
        const created = await subRequest("clergy", draft());
        assert.equal(created.status, 200);
        idea = (await created.json()).id;
        const createdDoc = await subRequest("clergy", draft("document"));
        document = (await createdDoc.json()).id;
        assert.equal(
          (await subRequest("manager", draft("idea", { id: idea, version: 1 }))).status,
          404,
        );
        assert.equal(
          (await subRequest("clergy", { action: "accepted", id: idea, version: 1 })).status,
          400,
        );
        assert.equal(
          (await subRequest("clergy", { action: "submit", id: document, version: 1 })).status,
          400,
        );
        assert.equal(
          (await subRequest("clergy", draft("idea", { id: idea, version: 1, abstract: "short" })))
            .status,
          200,
        );
        assert.equal(
          (await subRequest("clergy", { action: "submit", id: idea, version: 2 })).status,
          400,
        );
        assert.equal(
          (await subRequest("clergy", draft("idea", { id: idea, version: 2 }))).status,
          200,
        );
        assert.equal(
          (await subRequest("clergy", draft("idea", { id: idea, version: 2 }))).status,
          409,
        );
        const competing = await Promise.all([
          subRequest("clergy", { action: "submit", id: idea, version: 3 }),
          subRequest("clergy", { action: "submit", id: idea, version: 3 }),
        ]);
        assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
        assert.equal(
          (await subRequest("clergy", draft("idea", { id: idea, version: 4 }))).status,
          400,
        );
        assert.equal((await subRequest("manager", undefined, "?id=" + idea)).status, 404);
        await assert.rejects(
          as("clergy", (tx) => tx`update app.submissions set status='accepted' where id=${idea}`),
          { code: "42501" },
        );
        const own = await (await subRequest("clergy")).json();
        assert.equal(own.total, 2);
        assert.equal((await (await subRequest("manager")).json()).total, 0);
      },
    );
    await t.test("SQL whitespace validation and reviewer self-approval denial", async () => {
      await assert.rejects(
        as(
          "clergy",
          (tx) =>
            tx`select app.save_draft(null,0,'idea',${"\n".repeat(20)},'General','',array[]::text[],false)`,
        ),
      );
      const created = await subRequest("reviewer", draft("idea", { abstract: "\n".repeat(25) }));
      assert.equal(created.status, 200);
      const target = (await created.json()).id;
      assert.equal(
        (await subRequest("reviewer", { action: "submit", id: target, version: 1 })).status,
        400,
      );
      assert.equal(
        (await subRequest("reviewer", draft("idea", { id: target, version: 1 }))).status,
        200,
      );
      assert.equal(
        (await subRequest("reviewer", { action: "submit", id: target, version: 2 })).status,
        200,
      );
      await assert.rejects(
        as("reviewer", (tx) => tx`update app.submissions set status='accepted' where id=${target}`),
        { code: "42501" },
      );
      await assert.rejects(
        as(
          "reviewer",
          (tx) =>
            tx`insert into app.review_decisions(submission_id,reviewer_id,outcome) values(${target},${id("reviewer")},'accepted')`,
        ),
      );
    });
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
    async function upload(name: string, target: string, requestId = randomUUID()) {
      const response = await documents.handle(
        new Request(origin + "/api/documents?submissionId=" + target + "&requestId=" + requestId, {
          method: "POST",
          headers: {
            cookie: cookies.get(name) ?? "",
            origin,
            "Content-Type": "application/pdf",
            "X-Document-Name": "fixture.pdf",
          },
          body: pdf,
        }),
      );
      if (response.status === 201)
        await scanTestDocument(
          (await response.clone().json()).id,
          new LocalPrivateStorageProvider(root),
        );
      return response;
    }
    await t.test(
      "private upload integrated with draft, finalization, excluded failures and locking",
      async () => {
        assert.equal((await upload("manager", document)).status, 403);
        const uploaded = await upload("clergy", document);
        assert.equal(uploaded.status, 201);
        const doc = (await uploaded.json()).id;
        const pending = randomUUID();
        await as(
          "clergy",
          (tx) =>
            tx`insert into app.documents(id,submission_id,storage_key,file_name,media_type,byte_size) values(${pending},${document},${randomUUID()},'pending.pdf','application/pdf',0)`,
        );
        assert.equal(
          (await subRequest("clergy", { action: "submit", id: document, version: 1 })).status,
          400,
        );
        await as("clergy", (tx) => tx`select app.fail_document(${pending})`);
        assert.equal(
          (await subRequest("clergy", { action: "submit", id: document, version: 1 })).status,
          400,
        );
        assert.equal(
          (await subRequest("clergy", { action: "exclude", id: pending, version: 1 })).status,
          200,
        );
        assert.equal(
          (await subRequest("clergy", { action: "submit", id: document, version: 2 })).status,
          200,
        );
        assert.equal((await upload("clergy", document)).status, 403);
        const downloaded = await documents.handle(
          new Request(origin + "/api/documents/" + doc + "/download", {
            headers: { cookie: cookies.get("clergy")! },
          }),
          doc,
        );
        assert.equal(downloaded.status, 200);
        assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), pdf);
        const events =
          await owner.client`select action from app.audit_events where document_id=${doc}`;
        assert.ok(events.some((r) => r["action"] === "document.download.started"));
      },
    );
    await t.test(
      "returned amendment preserves immutable snapshots and existing review history",
      async () => {
        // Explicit disposable operator fixture simulates a future reviewer outcome, never a public review API.
        await owner.client`insert into app.review_decisions(submission_id,reviewer_id,outcome,notes) values(${idea},${id("reviewer")},'returned','Private reviewer note fixture')`;
        await owner.client`update app.submissions set status='returned' where id=${idea}`;
        assert.equal(
          (await subRequest("clergy", { action: "amend", id: idea, version: 4 })).status,
          200,
        );
        const detail = await (await subRequest("clergy", undefined, "?id=" + idea)).json();
        assert.equal(detail.submission.revision, 2);
        assert.equal(detail.submission.status, "draft");
        assert.ok(!JSON.stringify(detail).includes("Private reviewer note fixture"));
        assert.equal(
          (await subRequest("clergy", { action: "submit", id: idea, version: 5 })).status,
          200,
        );
        const [count] =
          await owner.client`select count(*)::int as count from app.review_decisions where submission_id=${idea}`;
        assert.equal(count!["count"], 1);
        assert.equal(
          (
            await as(
              "clergy",
              (tx) => tx`select * from app.review_decisions where submission_id=${idea}`,
            )
          ).length,
          0,
        );
        await assert.rejects(
          as("clergy", (tx) => tx`delete from app.submission_events where submission_id=${idea}`),
        );
      },
    );
    await t.test(
      "repository filters private metadata before counts and pagination for every role",
      async () => {
        await owner.client`update app.submissions set status='accepted' where id=${document}`;
        await owner.client`update app.submissions set status='accepted',confidential=true,title='Secret confidential fixture' where id=${idea}`;
        for (const n of ["manager", "clergy", "approver", "reviewer"]) {
          const shared = await (await subRequest(n, undefined, "?keyword=fixture", true)).json();
          assert.equal(shared.total, 1);
          assert.equal(shared.items[0].id, document);
          assert.equal((await subRequest(n, undefined, "?id=" + idea, true)).status, 404);
          assert.equal(
            (await (await subRequest(n, undefined, "?search=Secret", true)).json()).total,
            0,
          );
          assert.equal(
            (await (await subRequest(n, undefined, "?page=2&keyword=fixture", true)).json()).items
              .length,
            0,
          );
        }
        await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${id("manager")},'repository-v1','repository','withdrawn')`;
        assert.equal((await subRequest("manager", undefined, "", true)).status, 403);
        await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${id("manager")},'repository-v1','repository','accepted')`;
        await owner.client`update app.clergy_profiles set approval_status='suspended' where user_id=${id("manager")}`;
        assert.equal((await subRequest("manager", undefined, "", true)).status, 403);
        await owner.client`update app.clergy_profiles set approval_status='approved' where user_id=${id("manager")}`;
      },
    );
    await t.test(
      "registration verification approval draft PDF submit and owner listing sequence",
      async () => {
        const email = "sequence-" + prefix + "@example.invalid";
        const registration = await auth.handle(
          new Request(origin + "/api/auth/register", {
            method: "POST",
            headers: { origin, "Content-Type": "application/json" },
            body: JSON.stringify({
              email,
              password,
              confirmPassword: password,
              title: "Rev.",
              fullName: "Disposable Sequence",
              parish: "Test parish",
              acknowledged: true,
              noticeVersion: "repository-v1",
            }),
          }),
        );
        assert.equal(registration.status, 200);
        const [user] = await owner.client`select id from auth.users where email=${email}`;
        assert.ok(user);
        ids.push(String(user["id"]));
        const link = provider.messages
          .findLast((m) => m.to === email && m.subject.startsWith("Verify"))!
          .text.match(/http[^\s]+/)![0]!;
        assert.equal((await auth.handle(new Request(link))).status, 302);
        const signed = await auth.handle(
          new Request(origin + "/api/auth/sign-in/email", {
            method: "POST",
            headers: { origin, "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          }),
        );
        assert.equal(signed.status, 200);
        cookies.set(
          "sequence",
          signed.headers
            .getSetCookie()
            .map((v) => v.split(";")[0])
            .join("; "),
        );
        const approved = await approvals.handle(
          new Request(origin + "/api/registrations", {
            method: "POST",
            headers: {
              origin,
              cookie: cookies.get("approver")!,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              targetId: user["id"],
              action: "approve",
              reason: "Disposable sequence test",
              requestId: randomUUID(),
            }),
          }),
        );
        assert.equal(approved.status, 200);
        const created = await subRequest("sequence", draft("document"));
        assert.equal(created.status, 200);
        const target = (await created.json()).id;
        assert.equal((await upload("sequence", target)).status, 201);
        assert.equal(
          (await subRequest("sequence", { action: "submit", id: target, version: 1 })).status,
          200,
        );
        const listing = await (await subRequest("sequence")).json();
        assert.equal(listing.total, 1);
        assert.equal(listing.items[0].status, "submitted");
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    await runtime.close();
    await owner.client.begin(async (tx) => {
      for (const table of [
        "submission_events",
        "review_decisions",
        "account_approval_events",
        "email_settings_history",
        "email_test_attempts",
        "audit_events",
        "popia_consent_events",
      ])
        await tx.unsafe(`alter table app.${table} disable trigger user`);
      await tx`update app.email_settings set sending_domain=${initial!["sending_domain"]},display_name=${initial!["display_name"]},from_email=${initial!["from_email"]},reply_to=${initial!["reply_to"]},transactional_enabled=${initial!["transactional_enabled"]},notifications_enabled=${initial!["notifications_enabled"]},version=${initial!["version"]},updated_at=${initial!["updated_at"]},updated_by=${initial!["updated_by"]} where id=1`;
      await tx`update app.email_domains set authorized_at=${domain!["authorized_at"]} where domain='notifications.ctdiocese.org.za'`;
      await tx`delete from app.submission_events where actor_id=any(${ids})`;
      await tx`delete from app.review_decisions where reviewer_id=any(${ids})`;
      const fixtureSubmissions =
        await tx`select id from app.submissions where owner_id=any(${ids})`;
      await cleanTestScanRows(
        tx,
        fixtureSubmissions.map((s) => String(s["id"])),
      );
      await tx`delete from app.documents where submission_id in (select id from app.submissions where owner_id=any(${ids}))`;
      await tx`delete from app.submissions where owner_id=any(${ids})`;
      await tx`delete from app.account_approval_events where user_id=any(${ids})`;
      await tx`delete from app.email_settings_history where actor_id=any(${ids})`;
      await tx`delete from app.email_test_attempts where actor_id=any(${ids})`;
      await tx`delete from app.audit_events where actor_id=any(${ids}) or target_user_id=any(${ids})`;
      await tx`delete from app.settings_managers where user_id=any(${ids})`;
      await tx`delete from app.popia_consent_events where user_id=any(${ids})`;
      await tx`delete from app.approval_notifications where user_id=any(${ids})`;
      await tx`delete from app.role_assignments where user_id=any(${ids})`;
      await tx`delete from app.clergy_profiles where user_id=any(${ids})`;
      await tx`delete from auth.users where id=any(${ids})`;
      for (const table of [
        "submission_events",
        "review_decisions",
        "account_approval_events",
        "email_settings_history",
        "email_test_attempts",
        "audit_events",
        "popia_consent_events",
      ])
        await tx.unsafe(`alter table app.${table} enable trigger user`);
    });
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});
