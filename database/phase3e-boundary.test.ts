import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";

test("Checkpoint A: restricted review boundary", async (t) => {
  const owner = await connectLocalDatabase(),
    runtime = await connectLocalRuntime();
  const prefix = `p3e-boundary-${randomUUID()}`,
    ids = [`${prefix}-author`, `${prefix}-reviewer`, `${prefix}-admin`],
    target = randomUUID(),
    doc = randomUUID();
  const as = async <T>(id: string, work: (tx: import("postgres").TransactionSql) => Promise<T>) =>
    runtime.client.begin(async (tx) => {
      await tx`select set_config('cape.user_id',${id},true)`;
      return work(tx);
    });
  try {
    await owner.client.begin(async (tx) => {
      for (const id of ids) {
        await tx`insert into auth.users(id,name,email,email_verified) values(${id},'Boundary fixture',${id + "@example.invalid"},true)`;
        await tx`insert into app.clergy_profiles(user_id,full_name,approval_status) values(${id},'Boundary fixture','approved')`;
        await tx`insert into app.role_assignments(user_id,role) values(${id},'clergy')`;
        await tx`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${id},'repository-v1','repository','accepted')`;
      }
      await tx`insert into app.role_assignments(user_id,role) values(${ids[1]!},'reviewer'),(${ids[2]!},'admin')`;
      await tx`insert into app.submissions(id,owner_id,title,confidential) values(${target},${ids[0]!},'Confidential fixture',true)`;
      await tx`insert into app.documents(id,submission_id,storage_key,file_name,media_type,byte_size,state,sha256) values(${doc},${target},${randomUUID()},'fixture.pdf','application/pdf',12,'available',${"0".repeat(64)})`;
    });
    await t.test("direct status/history writes are denied to every role", async () => {
      for (const id of ids) {
        await assert.rejects(
          as(id, (tx) => tx`update app.submissions set status='accepted' where id=${target}`),
          { code: "42501" },
        );
        await assert.rejects(
          as(
            id,
            (tx) =>
              tx`insert into app.review_decisions(submission_id,reviewer_id,outcome) values(${target},${id},'accepted')`,
          ),
          { code: "42501" },
        );
      }
    });
    await t.test(
      "unassigned reviewer and admin cannot read confidential metadata or authorize bytes",
      async () => {
        for (const id of ids.slice(1)) {
          assert.equal(
            (await as(id, (tx) => tx`select id from app.submissions where id=${target}`)).length,
            0,
          );
          assert.equal(
            (await as(id, (tx) => tx`select id from app.documents where id=${doc}`)).length,
            0,
          );
          await assert.rejects(
            as(id, (tx) => tx`select app.record_document_access(${doc},'started',${randomUUID()})`),
            { code: "42501" },
          );
        }
      },
    );
    await t.test(
      "exact active revision permits access; revoke and new revision remove it",
      async () => {
        const [a] =
          await owner.client`insert into app.reviewer_assignments(submission_id,revision,reviewer_id,assigned_by) values(${target},1,${ids[1]!},session_user) returning id`;
        assert.equal(
          (await as(ids[1]!, (tx) => tx`select id from app.documents where id=${doc}`)).length,
          1,
        );
        await owner.client`update app.submissions set revision=2 where id=${target}`;
        assert.equal(
          (await as(ids[1]!, (tx) => tx`select id from app.submissions where id=${target}`)).length,
          0,
        );
        await owner.client`update app.submissions set revision=1 where id=${target}`;
        await owner.client`update app.reviewer_assignments set status='revoked',revoked_at=now() where id=${a!["id"]}`;
        assert.equal(
          (await as(ids[1]!, (tx) => tx`select id from app.documents where id=${doc}`)).length,
          0,
        );
      },
    );
    await t.test("owner access remains available", async () =>
      assert.equal(
        (await as(ids[0]!, (tx) => tx`select id from app.documents where id=${doc}`)).length,
        1,
      ),
    );
  } finally {
    await owner.client.begin(async (tx) => {
      await tx`delete from app.reviewer_assignments where submission_id=${target}`;
      await tx`delete from app.documents where submission_id=${target}`;
      await tx`delete from app.submissions where id=${target}`;
      await tx`alter table app.popia_consent_events disable trigger user`;
      await tx`delete from app.popia_consent_events where user_id=any(${ids})`;
      await tx`alter table app.popia_consent_events enable trigger user`;
      await tx`delete from app.role_assignments where user_id=any(${ids})`;
      await tx`delete from app.clergy_profiles where user_id=any(${ids})`;
      await tx`delete from auth.users where id=any(${ids})`;
    });
    await runtime.close();
    await owner.close();
  }
});
