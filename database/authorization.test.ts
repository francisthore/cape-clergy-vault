import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import type { TransactionSql } from "postgres";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";
import { createLocalAuth } from "./auth/config.server.ts";
import { createRequestDatabaseBoundary } from "./context.server.ts";

const prefix = `p2b-${randomUUID()}`;
const ids = Object.fromEntries(
  [
    "alice",
    "bob",
    "pending",
    "rejected",
    "suspended",
    "reviewer",
    "admin",
    "noConsent",
    "oldConsent",
  ].map((k) => [k, `${prefix}-${k}`]),
) as Record<string, string>;
const get = (key: string) => ids[key]!;
const privateId = randomUUID(),
  sharedId = randomUUID(),
  confidentialId = randomUUID();
const messageId = randomUUID();

test("Phase 2B: actual restricted runtime login, authorization and Better Auth integration", async (t) => {
  const owner = await connectLocalDatabase();
  const runtime = await connectLocalRuntime();
  const authIds: string[] = [];
  const as = async <T>(who: string | null, operation: (tx: TransactionSql) => Promise<T>) => {
    // Fixture identity injection exists ONLY in tests; production boundary takes headers.
    return runtime.client.begin(async (tx) => {
      await tx`select set_config('cape.user_id', ${who ? get(who) : ""}, true)`;
      return operation(tx);
    });
  };
  const denied = async (
    tx: TransactionSql,
    operation: (sp: TransactionSql) => Promise<unknown>,
    code = "42501",
  ) => {
    await assert.rejects(
      tx.savepoint(async (sp) => {
        await operation(sp);
      }),
      (e: unknown) => (e as { code?: string }).code === code,
    );
  };
  const count = async (tx: TransactionSql, table: string) => {
    const [row] = await tx.unsafe(`select count(*)::int as n from app.${table}`);
    return row!["n"] as number;
  };
  try {
    await owner.client.begin(async (tx) => {
      for (const [key, id] of Object.entries(ids)) {
        await tx`insert into auth.users(id,name,email,email_verified) values (${id},${key},${id + "@example.invalid"},true)`;
        const state = ["pending", "rejected", "suspended"].includes(key) ? key : "approved";
        await tx`insert into app.clergy_profiles(user_id,full_name,approval_status) values (${id},${key},${state})`;
        await tx`insert into app.role_assignments(user_id,role) values (${id},${["reviewer", "admin"].includes(key) ? key : "clergy"})`;
        if (key !== "noConsent") {
          for (const purpose of ["repository", "private_chat"]) {
            const version =
              key === "oldConsent"
                ? "old-v0"
                : purpose === "repository"
                  ? "repository-v1"
                  : "private-chat-v1";
            await tx`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values (${id},${version},${purpose},'accepted')`;
          }
        }
      }
      await tx`insert into app.submissions(id,owner_id,title,status,confidential) values
        (${privateId},${get("alice")},'Private','submitted',false),
        (${sharedId},${get("alice")},'Shared','accepted',false),
        (${confidentialId},${get("alice")},'Confidential','accepted',true)`;
      for (const id of [privateId, sharedId, confidentialId]) {
        await tx`insert into app.documents(submission_id,storage_key,file_name,media_type,byte_size) values
          (${id},${get("alice") + "/" + id},'fixture.pdf','application/pdf',12)`;
      }
      await tx`insert into app.chat_messages(id,owner_id,sender_id,body) values (${messageId},${get("alice")},${get("alice")},'Private fixture')`;
      await tx`insert into app.audit_events(actor_id,action,outcome) values (${get("alice")},'fixture','ok')`;
    });

    await t.test("missing identity denies all protected reads and writes", async () => {
      await as(null, async (tx) => {
        for (const table of [
          "clergy_profiles",
          "submissions",
          "documents",
          "chat_messages",
          "review_decisions",
          "audit_events",
          "role_assignments",
          "popia_consent_events",
          "account_approval_events",
          "chat_notification_preferences",
        ])
          assert.equal(await count(tx, table), 0, table);
        await denied(
          tx,
          (sp) => sp`insert into app.submissions(owner_id,title) values (${get("alice")},'Forged')`,
        );
        await denied(
          tx,
          (sp) =>
            sp`insert into app.audit_events(actor_id,action,outcome) values (${get("alice")},'forged','ok')`,
        );
      });
    });
    await t.test(
      "pending, rejected, suspended, missing and obsolete consent deny protected content",
      async () => {
        for (const who of ["pending", "rejected", "suspended", "noConsent", "oldConsent"])
          await as(who, async (tx) => {
            for (const table of ["submissions", "documents", "chat_messages", "review_decisions"])
              assert.equal(await count(tx, table), 0, `${who}: ${table}`);
            await denied(
              tx,
              (sp) => sp`insert into app.submissions(owner_id,title) values (${get(who)},'Denied')`,
            );
            await denied(
              tx,
              (sp) =>
                sp`insert into app.chat_messages(id,owner_id,sender_id,body) values (${randomUUID()},${get(who)},${get(who)},'Denied')`,
            );
          });
      },
    );
    await t.test("owner access, shared acceptance and confidential isolation", async () => {
      await as("alice", async (tx) => {
        assert.equal(await count(tx, "submissions"), 3);
        assert.equal(await count(tx, "documents"), 3);
        assert.equal(await count(tx, "chat_messages"), 1);
        assert.equal(await count(tx, "clergy_profiles"), 1);
        const [row] =
          await tx`insert into app.submissions(owner_id,title) values (${get("alice")},'New own') returning id`;
        await tx`insert into app.documents(submission_id,storage_key,file_name,media_type,byte_size) values (${row!["id"]},${get("alice") + "/new"},'a','b',0)`;
        await denied(
          tx,
          (sp) =>
            sp`insert into app.documents(submission_id,storage_key,file_name,media_type,byte_size) values (${row!["id"]},'someone-else/key','a','b',0)`,
        );
      });
      await as("bob", async (tx) => {
        await tx`select set_config('cape.role', 'admin', true)`; // Untrusted role claims are ignored.
        assert.deepEqual(
          (await tx`select id from app.submissions`).map((r) => r["id"]),
          [sharedId],
        );
        assert.equal(await count(tx, "documents"), 1);
        assert.equal(await count(tx, "chat_messages"), 0);
        await denied(
          tx,
          (sp) => sp`insert into app.submissions(owner_id,title) values (${get("alice")},'Forged')`,
        );
        await denied(
          tx,
          (sp) =>
            sp`insert into app.submissions(owner_id,title,status) values (${get("bob")},'Auto accept','accepted')`,
        );
        await denied(
          tx,
          (sp) =>
            sp`insert into app.documents(submission_id,storage_key,file_name,media_type,byte_size) values (${privateId},${get("bob") + "/x"},'a','b',0)`,
        );
        await denied(
          tx,
          (sp) =>
            sp`insert into app.chat_messages(id,owner_id,sender_id,body) values (${randomUUID()},${get("alice")},${get("bob")},'Intrusion')`,
        );
        await denied(
          tx,
          (sp) =>
            sp`insert into app.review_decisions(submission_id,reviewer_id,outcome) values (${sharedId},${get("bob")},'accepted')`,
        );
        assert.equal(
          (await tx`update app.submissions set status = 'accepted' where id = ${privateId}`).count,
          0,
        );
        await denied(
          tx,
          (sp) => sp`update app.submissions set owner_id = ${get("bob")} where id = ${sharedId}`,
        );
        await denied(tx, (sp) => sp`update app.clergy_profiles set approval_status = 'approved'`);
        await denied(
          tx,
          (sp) => sp`insert into app.role_assignments(user_id,role) values (${get("bob")},'admin')`,
        );
        await denied(
          tx,
          (sp) =>
            sp`insert into app.account_approval_events(user_id,actor_id,status) values (${get("bob")},${get("bob")},'approved')`,
        );
      });
    });
    await t.test("live reviewer access, explicit roles and revocation", async () => {
      await as("reviewer", async (tx) => {
        assert.ok((await count(tx, "submissions")) >= 3);
        assert.equal(await count(tx, "chat_messages"), 1);
        assert.equal(await count(tx, "audit_events"), 0);
        assert.equal(
          (await tx`update app.submissions set status = 'under_review' where id = ${privateId}`)
            .count,
          1,
        );
        await tx`insert into app.review_decisions(submission_id,reviewer_id,outcome) values (${privateId},${get("reviewer")},'under_review')`;
        await tx`insert into app.chat_messages(id,owner_id,sender_id,body) values (${randomUUID()},${get("alice")},${get("reviewer")},'Reply')`;
        await denied(
          tx,
          (sp) =>
            sp`insert into app.review_decisions(submission_id,reviewer_id,outcome) values (${privateId},${get("admin")},'accepted')`,
        );
        await denied(tx, (sp) => sp`update app.role_assignments set revoked_at = now()`);
      });
      await owner.client`update app.role_assignments set revoked_at = now() where user_id = ${get("reviewer")}`;
      await as("reviewer", async (tx) => {
        assert.equal(await count(tx, "chat_messages"), 0);
        assert.equal(
          (await tx`update app.submissions set status = 'accepted' where id = ${privateId}`).count,
          0,
        );
      });
      await as("admin", async (tx) => {
        assert.ok((await count(tx, "audit_events")) >= 1);
        assert.ok((await count(tx, "clergy_profiles")) >= Object.keys(ids).length);
        await denied(tx, (sp) => sp`update app.audit_events set action = 'changed'`);
        await denied(tx, (sp) => sp`delete from app.audit_events`);
        await denied(tx, (sp) => sp`truncate app.audit_events`);
      });
    });
    await t.test(
      "consent withdrawal, immutable history, notification scope and server timestamps",
      async () => {
        await as("alice", async (tx) => {
          await tx`insert into app.chat_notification_preferences(user_id,owner_id,muted) values (${get("alice")},${get("alice")},true)`;
          await tx`update app.chat_notification_preferences set muted = false where user_id = ${get("alice")}`;
          await denied(
            tx,
            (sp) =>
              sp`insert into app.chat_notification_preferences(user_id,owner_id) values (${get("bob")},${get("alice")})`,
          );
          await denied(tx, (sp) => sp`update app.chat_messages set body = 'changed'`);
          await denied(tx, (sp) => sp`delete from app.chat_messages`);
          await denied(
            tx,
            (sp) =>
              sp`insert into app.popia_consent_events(user_id,notice_version,purpose,action,created_at) values (${get("alice")},'repository-v1','repository','accepted',now() + interval '1 year')`,
          );
          await denied(
            tx,
            (sp) =>
              sp`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values (${get("bob")},'repository-v1','repository','accepted')`,
          );
          await tx`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values (${get("alice")},'repository-v1','repository','withdrawn')`;
          assert.equal(await count(tx, "submissions"), 0);
          await tx`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values (${get("alice")},'private-chat-v1','private_chat','withdrawn')`;
          assert.equal(await count(tx, "chat_messages"), 0);
          assert.equal(await count(tx, "chat_notification_preferences"), 0);
        });
        await as("admin", async (tx) => assert.equal(await count(tx, "chat_messages"), 0));
        await owner.client`update app.clergy_profiles set approval_status = 'suspended' where user_id = ${get("admin")}`;
        await as("admin", async (tx) => {
          assert.equal(await count(tx, "submissions"), 0);
          assert.equal(await count(tx, "audit_events"), 0);
        });
        await owner.client`update app.clergy_profiles set approval_status = 'approved' where user_id = ${get("admin")}`;
      },
    );
    await t.test(
      "runtime cannot bypass RLS, acquire migration rights or change schema",
      async () => {
        await as("admin", async (tx) => {
          const [role] =
            await tx`select current_user as name, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname=current_user`;
          assert.equal(role!["name"], "cape_clergy_runtime");
          for (const key of ["rolsuper", "rolbypassrls", "rolcreatedb", "rolcreaterole"])
            assert.equal(role![key], false);
          for (const query of [
            "set local role cape_clergy_dev",
            "set local role cape_local_bootstrap",
            "alter table app.submissions disable row level security",
            "alter table app.audit_events disable trigger all",
            "create table app.forbidden(id text)",
            "create table auth.forbidden(id text)",
            "create table public.forbidden(id text)",
            "create schema forbidden",
            "create temporary table forbidden(id text)",
            "select * from cape_migrations.__drizzle_migrations",
            "create role forbidden",
            "truncate auth.sessions",
          ])
            await denied(tx, (sp) => sp.unsafe(query));
          await denied(tx, (sp) => sp`select app.reject_history_mutation()`);
        });
        await as("bob", async (tx) => {
          await tx`set local row_security = off`;
          await denied(tx, (sp) => sp`select * from app.submissions`);
        });
      },
    );
    await t.test("runtime auth CRUD, generated constraints and profile retention FK", async () => {
      const id = `${prefix}-auth-crud`;
      authIds.push(id);
      await runtime.client.begin(async (tx) => {
        await tx`insert into auth.users(id,name,email) values (${id},'Auth',${id + "@example.invalid"})`;
        await tx`insert into auth.accounts(id,account_id,provider_id,user_id,updated_at) values (${id},${id},'credential',${id},now())`;
        await tx`insert into auth.sessions(id,token,user_id,expires_at,updated_at) values (${id},${id},${id},now()+interval '1 hour',now())`;
        await tx`insert into auth.verifications(id,identifier,value,expires_at) values (${id},${id},'fixture',now()+interval '1 hour')`;
        await tx`update auth.users set name = 'Updated' where id=${id}`;
        await tx`update auth.accounts set password = 'fixture-hash' where id=${id}`;
        await tx`update auth.sessions set expires_at = now() where id=${id}`;
        await tx`update auth.verifications set value = 'updated' where id=${id}`;
        for (const table of ["users", "accounts", "sessions", "verifications"])
          assert.equal(
            (await tx.unsafe(`select * from auth.${table} where id=$1`, [id])).length,
            1,
          );
        await denied(
          tx,
          (sp) =>
            sp`insert into auth.users(id,name,email) values (${id + "-duplicate"},'Dup',${id + "@example.invalid"})`,
          "23505",
        );
        await denied(
          tx,
          (sp) =>
            sp`insert into auth.sessions(id,token,user_id,expires_at,updated_at) values ('missing','missing','no-such-user',now(),now())`,
          "23503",
        );
        await denied(tx, (sp) => sp`delete from auth.users where id=${get("alice")}`, "23503");
        await tx`delete from auth.users where id=${id}`;
        assert.equal((await tx`select * from auth.accounts where id=${id}`).length, 0);
        assert.equal((await tx`select * from auth.sessions where id=${id}`).length, 0);
        await tx`delete from auth.verifications where id=${id}`;
      });
      await assert.rejects(
        owner.client`insert into app.clergy_profiles(user_id,full_name) values (${prefix + "-missing"},'Missing')`,
        (e: unknown) => (e as { code?: string }).code === "23503",
      );
    });
    await t.test(
      "real Better Auth signup, verification, password login, DB session and signout without routes",
      async () => {
        const email = `${prefix}@example.invalid`;
        let token: string | undefined;
        const auth = createLocalAuth(runtime, {
          secret: randomBytes(32).toString("hex"),
          baseURL: "http://localhost:3211",
          sendVerificationEmail: async (data) => {
            token = data.token;
          },
        });
        const result = await auth.api.signUpEmail({
          body: { name: "Local fixture", email, password: "Local-test-password-123!" },
        });
        authIds.push(result.user.id);
        assert.equal(result.token, null);
        assert.ok(token);
        await assert.rejects(
          auth.api.signInEmail({ body: { email, password: "Local-test-password-123!" } }),
        );
        await auth.api.verifyEmail({ query: { token: token! } });
        const login = await auth.api.signInEmail({
          body: { email, password: "Local-test-password-123!" },
        });
        assert.ok(login.token);
        const headers = new Headers({ authorization: `Bearer ${login.token}` });
        // Better Auth uses cookies by default (no bearer plugin configured).
        const response = await auth.api.signInEmail({
          body: { email, password: "Local-test-password-123!" },
          asResponse: true,
        });
        const cookie = response.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
        headers.delete("authorization");
        headers.set("cookie", cookie);
        const session = await auth.api.getSession({ headers });
        assert.equal(session?.user.id, result.user.id);
        const boundary = createRequestDatabaseBoundary(runtime, (h) =>
          auth.api.getSession({ headers: h }),
        );
        await boundary(headers, async (tx) => {
          const [row] = await tx`select app.request_user_id() as id`;
          assert.equal(row!["id"], result.user.id);
          assert.equal(await count(tx, "submissions"), 0); // No approved profile.
        });
        await assert.rejects(boundary(new Headers(), async () => 1));
        await auth.api.signOut({ headers });
        assert.equal(await auth.api.getSession({ headers }), null);
      },
    );
    await t.test(
      "transaction identity resets on commit, rollback and concurrent pool reuse",
      async () => {
        for (let i = 0; i < 8; i++) {
          await Promise.all(
            ["alice", "bob"].map((who) =>
              as(who, async (tx) => {
                const [row] = await tx`select app.request_user_id() as id`;
                assert.equal(row!["id"], get(who));
              }),
            ),
          );
          const marker = new Error("rollback");
          await assert.rejects(
            as("admin", async () => {
              throw marker;
            }),
            (e) => e === marker,
          );
          await Promise.all(
            [1, 2].map(async () =>
              runtime.client.begin(async (tx) => {
                const [row] = await tx`select app.request_user_id() as id`;
                assert.equal(row!["id"], null);
                assert.equal(await count(tx, "submissions"), 0);
              }),
            ),
          );
        }
      },
    );
  } finally {
    // Only generated fixture identities; owner-only cleanup in isolated test DB.
    // Trigger disable/delete/enable is atomic and locks tables until commit.
    try {
      await owner.client.begin(async (tx) => {
        const fixtureIds = [...Object.values(ids), ...authIds];
        for (const table of [
          "review_decisions",
          "chat_messages",
          "account_approval_events",
          "popia_consent_events",
          "audit_events",
        ])
          await tx.unsafe(`alter table app.${table} disable trigger user`);
        await tx`delete from app.review_decisions where reviewer_id = any(${fixtureIds})`;
        await tx`delete from app.documents where submission_id in (select id from app.submissions where owner_id = any(${fixtureIds}))`;
        await tx`delete from app.submissions where owner_id = any(${fixtureIds})`;
        await tx`delete from app.chat_messages where owner_id = any(${fixtureIds})`;
        await tx`delete from app.chat_notification_preferences where user_id = any(${fixtureIds}) or owner_id = any(${fixtureIds})`;
        await tx`delete from app.account_approval_events where user_id = any(${fixtureIds})`;
        await tx`delete from app.popia_consent_events where user_id = any(${fixtureIds})`;
        await tx`delete from app.audit_events where actor_id = any(${fixtureIds})`;
        await tx`delete from app.approval_notifications where user_id=any(${fixtureIds})`;
        await tx`delete from app.role_assignments where user_id = any(${fixtureIds})`;
        await tx`delete from app.clergy_profiles where user_id = any(${fixtureIds})`;
        await tx`delete from auth.users where id = any(${fixtureIds})`;
        await tx`delete from auth.verifications where identifier = ${prefix + "@example.invalid"} or id = ${prefix + "-auth-crud"}`;
        for (const table of [
          "review_decisions",
          "chat_messages",
          "account_approval_events",
          "popia_consent_events",
          "audit_events",
        ])
          await tx.unsafe(`alter table app.${table} enable trigger user`);
      });
    } finally {
      await runtime.close();
      await owner.close();
    }
  }
});
