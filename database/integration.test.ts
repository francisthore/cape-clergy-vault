import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { connectLocalDatabase } from "./connection.server.ts";
import { profiles, submissions } from "./schema/index.ts";

test("isolated PostgreSQL foundation: integrity, immutability, RLS and migration ledger", async (t) => {
  const connection = await connectLocalDatabase();
  const rollback = new Error("test rollback");
  try {
    const [baseline] =
      await connection.client`select count(*)::int as count from app.clergy_profiles`;
    const ledger =
      await connection.client`select hash from cape_migrations.__drizzle_migrations order by id`;
    assert.equal(ledger.length, 6);
    const tables = await connection.client`
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relkind = 'r'
    `;
    assert.equal(tables.length, 10);
    assert.ok(tables.every((row) => row["relrowsecurity"] === true));
    assert.ok(
      (await connection.client`select * from pg_policies where schemaname = 'app'`).length > 0,
    );
    assert.equal(
      (
        await connection.client`select table_name from information_schema.tables where table_schema = 'auth'`
      ).length,
      4,
    );
    // Exercise inferred insert/select types and the reusable Drizzle connection.
    await assert.rejects(
      connection.db.transaction(async (tx) => {
        await tx.execute(
          sql`insert into auth.users(id,name,email) values ('opaque-better-auth-id','Fixture','opaque@example.invalid')`,
        );
        const [profile] = await tx
          .insert(profiles)
          .values({ userId: "opaque-better-auth-id", fullName: "Fixture" })
          .returning();
        assert.equal(profile?.approvalStatus, "pending");
        const [submission] = await tx
          .insert(submissions)
          .values({ ownerId: profile!.userId, title: "Fixture" })
          .returning();
        assert.equal(submission?.status, "submitted");
        throw rollback;
      }),
      (error) => error === rollback,
    );

    await assert.rejects(
      connection.client.begin(async (tx) => {
        const owner = `fixture-${randomUUID()}`;
        const other = `reviewer-${randomUUID()}`;
        await tx`insert into auth.users(id,name,email) values (${owner},'Fixture',${owner + "@example.invalid"}), (${other},'Reviewer',${other + "@example.invalid"})`;
        await tx`insert into app.clergy_profiles(user_id, full_name) values (${owner}, 'Fixture'), (${other}, 'Reviewer')`;
        const [submission] =
          await tx`insert into app.submissions(owner_id, title) values (${owner}, 'Fixture') returning id`;
        const id = submission!["id"] as string;
        const violation = async (query: () => Promise<unknown>, code: string) => {
          await assert.rejects(
            tx.savepoint(query),
            (error: unknown) => (error as { code?: string }).code === code,
          );
        };
        await t.test("foreign keys, enums, checks and active role uniqueness", async () => {
          await violation(async () => {
            await tx`insert into app.submissions(owner_id,title) values ('missing','Fixture')`;
          }, "23503");
          await violation(async () => {
            await tx`insert into app.submissions(owner_id,title) values (${owner},' ')`;
          }, "23514");
          await violation(async () => {
            await tx`insert into app.submissions(owner_id,title,status) values (${owner},'Fixture','invalid')`;
          }, "22P02");
          await tx`insert into app.role_assignments(user_id, role, granted_by) values (${other}, 'admin', ${owner})`;
          await violation(async () => {
            await tx`insert into app.role_assignments(user_id, role) values (${other}, 'admin')`;
          }, "23505");
          await tx`update app.role_assignments set revoked_at = now() where user_id = ${other}`;
          await tx`insert into app.role_assignments(user_id, role) values (${other}, 'admin')`;
          await violation(async () => {
            await tx`insert into app.documents(submission_id, storage_key, file_name, media_type, byte_size) values (${id}, 'fixture/key', 'file.pdf', 'application/pdf', -1)`;
          }, "23514");
        });
        await t.test(
          "consent acceptance and withdrawal history, immutable evidence and chat",
          async () => {
            await tx`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values (${owner},'fixture-v1','repository','accepted'), (${owner},'fixture-v1','repository','withdrawn')`;
            const [latest] =
              await tx`select action from app.popia_consent_events where user_id = ${owner} order by created_at desc, id desc limit 1`;
            assert.equal(latest!["action"], "withdrawn");
            await tx`insert into app.account_approval_events(user_id,actor_id,status) values (${owner},${other},'approved')`;
            await tx`insert into app.review_decisions(submission_id,reviewer_id,outcome) values (${id},${other},'accepted')`;
            await tx`insert into app.audit_events(actor_id,action,outcome) values (${owner},'fixture','ok')`;
            const messageId = randomUUID();
            await tx`insert into app.chat_messages(id,owner_id,sender_id,body) values (${messageId},${owner},${owner},'Fixture')`;
            await violation(async () => {
              await tx`insert into app.chat_messages(id,owner_id,sender_id,body) values (${messageId},${owner},${owner},'Fixture')`;
            }, "23505");
            await violation(async () => {
              await tx`insert into app.chat_messages(id,owner_id,sender_id,body) values (${randomUUID()},${owner},${owner},' ')`;
            }, "23514");
            for (const table of [
              "audit_events",
              "popia_consent_events",
              "account_approval_events",
              "review_decisions",
              "chat_messages",
            ]) {
              for (const statement of [
                `update app.${table} set created_at = now()`,
                `delete from app.${table}`,
                `truncate app.${table}`,
              ]) {
                // Table names and SQL are test constants. Every attempted mutation rolls back to a savepoint.
                await violation(async () => {
                  await tx.unsafe(statement);
                }, "55000");
              }
            }
          },
        );
        throw rollback;
      }),
      (error) => error === rollback,
    );
    const [remaining] =
      await connection.client`select count(*)::int as count from app.clergy_profiles`;
    assert.equal(remaining!["count"], baseline!["count"]);
  } finally {
    await connection.close();
  }
});
