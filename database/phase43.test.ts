// Phase 4.3 security audit probes. Runs only inside the whole-disposable-cluster runner
// (scripts/db/phase41b-test.ts --phase43) using synthetic identities. It never touches the
// persistent database, never disables a trigger and never deletes history rows.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { TransactionSql } from "postgres";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";
import { connectLocalScanner } from "./scanner.server.ts";
import { readDisposableManifest, assertDisposableDatabase } from "./disposable-phase41b.server.ts";
import {
  auditFunctions,
  auditGrants,
  auditImmutableTriggers,
  auditMigrationLedger,
  auditRls,
  auditRoles,
} from "./security-contract.ts";
import { appendOnlyTables } from "./test-fixture-audit.ts";

test("Phase 4.3 reviewed security contract holds on a fresh forward-migrated cluster", async () => {
  const manifest = await readDisposableManifest();
  const owner = await connectLocalDatabase();
  try {
    await assertDisposableDatabase(owner.client, manifest);
    const checks: string[] = [];
    // Fresh migrations + reviewed grant files must produce the same contract as the persistent
    // environment (detects drift between the migration ledger and the *-grants.sql setup files).
    await auditMigrationLedger(owner.client, checks);
    await auditRoles(owner.client, checks);
    await auditRls(owner.client, checks);
    await auditGrants(owner.client, checks);
    await auditFunctions(owner.client, checks);
    await auditImmutableTriggers(owner.client, checks);
    for (const check of checks) console.log("  contract:", check);
    assert.ok(checks.length >= 6);
  } finally {
    await owner.close();
  }
});

test("Phase 4.3 horizontal and vertical privilege-escalation probes (synthetic identities)", async (t) => {
  const manifest = await readDisposableManifest();
  const owner = await connectLocalDatabase(),
    runtime = await connectLocalRuntime();
  await assertDisposableDatabase(owner.client, manifest);
  const prefix = "p43-" + randomUUID();
  const as = <T>(who: string, work: (tx: TransactionSql) => Promise<T>) =>
    runtime.client.begin(async (tx) => {
      await tx`select set_config('cape.user_id',${who},true)`;
      return work(tx);
    });
  const seed = async (label: string, status = "approved", roles: string[] = []) => {
    const who = prefix + "-" + label;
    await owner.client`insert into auth.users(id,name,email,email_verified) values(${who},'Synthetic clergy',${who + "@example.invalid"},true)`;
    await owner.client`insert into app.clergy_profiles(user_id,full_name,title,parish,approval_status) values(${who},'Synthetic clergy','Rev.','Synthetic parish',${status})`;
    for (const role of ["clergy", ...roles])
      await owner.client`insert into app.role_assignments(user_id,role) values(${who},${role})`;
    await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${who},'repository-v1','repository','accepted')`;
    return who;
  };
  const draft = async (who: string, confidential = false) =>
    String(
      (
        await as(
          who,
          (tx) =>
            tx`select app.save_draft(null,0,'idea','Synthetic private title','General','A meaningful description for this synthetic theological proposal.',array[]::text[],${confidential}) id`,
        )
      )[0]!["id"],
    );
  try {
    const a = await seed("author-a"),
      b = await seed("author-b"),
      pending = await seed("pending", "pending"),
      admin = await seed("admin", "approved", ["admin"]),
      reviewer = await seed("reviewer", "approved", ["reviewer"]);
    const secretDraft = await draft(a, true);
    await as(a, (tx) => tx`select app.transition_submission(${secretDraft},1,'submit')`);
    const openDraft = await draft(a);
    const storageKey = randomUUID();
    await owner.client`insert into app.documents(id,submission_id,storage_key,file_name,media_type,byte_size,upload_request_id)
      values(${randomUUID()},${openDraft},${storageKey},'synthetic.pdf','application/pdf',0,${randomUUID()})`;

    await t.test(
      "horizontal: another approved clergy member sees none of the author's rows",
      async () => {
        for (const table of ["submissions", "documents", "submission_events", "review_decisions"]) {
          const rows = await as(b, (tx) => tx.unsafe(`select count(*)::int n from app.${table}`));
          assert.equal(rows[0]!["n"], 0, `${table} must be invisible to a different author`);
        }
        await assert.rejects(
          as(
            b,
            (tx) =>
              tx`select app.save_draft(${openDraft},1,'idea','Hijacked','General','A meaningful description for this synthetic theological proposal.',array[]::text[],false)`,
          ),
        );
        await assert.rejects(
          as(b, (tx) => tx`select app.transition_submission(${openDraft},1,'submit')`),
        );
        assert.equal(
          (await as(b, (tx) => tx`select app.can_review_submission(${secretDraft}) ok`))[0]!["ok"],
          false,
        );
        assert.equal(
          (
            await as(b, (tx) => tx`select app.document_is_clean(${storageKey}::uuid) ok`).catch(
              () => [{ ok: false }],
            )
          )[0]!["ok"],
          false,
        );
      },
    );

    await t.test(
      "horizontal: pending/unapproved accounts cannot create or submit resources",
      async () => {
        await assert.rejects(draft(pending));
        assert.equal(
          (await as(pending, (tx) => tx`select count(*)::int n from app.submissions`))[0]!["n"],
          0,
        );
      },
    );

    await t.test("vertical: ordinary clergy cannot reach any privileged function", async () => {
      const attempts: [string, (tx: TransactionSql) => PromiseLike<unknown>][] = [
        ["coordination_inbox", (tx) => tx`select app.coordination_inbox(1)`],
        ["access_identity", (tx) => tx`select app.access_identity(${a})`],
        [
          "manage_access",
          (tx) =>
            tx`select app.manage_access('grant',${b},'approver',${b + "@example.invalid"},${"GRANT " + b + " approver"},'Synthetic escalation attempt',${randomUUID()})`,
        ],
        [
          "decide_registration",
          (tx) => tx`select app.decide_registration(${pending},'approve','',${randomUUID()})`,
        ],
        ["registration_list", (tx) => tx`select app.registration_list('pending','',1)`],
        [
          "decide_review",
          (tx) => tx`select app.decide_review(${secretDraft},2,'accept','x','x',${randomUUID()})`,
        ],
        [
          "coordinate_assignment",
          (tx) => tx`select app.coordinate_assignment(${secretDraft},1,${a},${randomUUID()})`,
        ],
        [
          "save_email_settings",
          (tx) =>
            tx`select app.save_email_settings(0,'example.invalid','x','x@example.invalid','x@example.invalid',false,false)`,
        ],
      ];
      for (const [name, work] of attempts)
        await assert.rejects(
          as(b, (tx) => work(tx) as Promise<unknown>),
          Error,
          `${name} must refuse an ordinary clergy account`,
        );
    });

    await t.test(
      "vertical: no direct table writes can mint privileges, assignments, decisions or status",
      async () => {
        for (const sql of [
          `insert into app.role_assignments(user_id,role) values('${b}','approver')`,
          `insert into app.role_assignments(user_id,role) values('${b}','reviewer')`,
          `insert into app.operational_grants(user_id,capability) values('${b}','access_manager')`,
          `insert into app.reviewer_assignments(submission_id,revision,reviewer_id,assigned_by) values('${secretDraft}',1,'${b}','${b}')`,
          `insert into app.review_decisions(submission_id,reviewer_id,decision) values('${secretDraft}','${b}','accepted')`,
          `update app.submissions set status='accepted' where id='${openDraft}'`,
          `update app.clergy_profiles set approval_status='approved' where user_id='${pending}'`,
          `update app.documents set state='available'`,
          `delete from app.audit_events`,
        ])
          await assert.rejects(
            as(b, (tx) => tx.unsafe(sql)),
            Error,
            sql,
          );
      },
    );

    await t.test(
      "vertical: system administrator has no implicit reviewer or confidential access",
      async () => {
        assert.equal((await as(admin, (tx) => tx`select app.is_reviewer() ok`))[0]!["ok"], false);
        assert.equal(
          (await as(admin, (tx) => tx`select app.can_review_submission(${secretDraft}) ok`))[0]![
            "ok"
          ],
          false,
        );
        assert.equal(
          (
            await as(
              admin,
              (tx) => tx`select count(*)::int n from app.submissions where confidential`,
            )
          )[0]!["n"],
          0,
        );
        await assert.rejects(
          as(admin, (tx) => tx`select app.coordination_inbox(1)`),
          { code: "42501" },
        );
      },
    );

    await t.test(
      "vertical: an unassigned reviewer cannot read or decide confidential work",
      async () => {
        assert.equal(
          (await as(reviewer, (tx) => tx`select app.can_review_submission(${secretDraft}) ok`))[0]![
            "ok"
          ],
          false,
        );
        assert.equal(
          (
            await as(
              reviewer,
              (tx) => tx`select count(*)::int n from app.submissions where id=${secretDraft}`,
            )
          )[0]!["n"],
          0,
        );
        await assert.rejects(
          as(
            reviewer,
            (tx) => tx`select app.decide_review(${secretDraft},2,'accept','x','x',${randomUUID()})`,
          ),
        );
      },
    );

    await t.test(
      "append-only histories reject runtime UPDATE/DELETE/TRUNCATE even when privileges exist",
      async () => {
        for (const table of appendOnlyTables)
          for (const sql of [
            `update app.${table} set id=id`,
            `delete from app.${table}`,
            `truncate app.${table}`,
          ])
            await assert.rejects(
              as(a, (tx) => tx.unsafe(sql)),
              Error,
              `${table}: ${sql}`,
            );
        // The table owner is not exempt. Row triggers only fire when a row exists, so DELETE/UPDATE
        // are asserted only for populated histories; the statement-level TRUNCATE guard always fires.
        for (const table of appendOnlyTables) {
          await assert.rejects(
            owner.client.unsafe(`truncate app.${table}`),
            Error,
            `owner truncate ${table}`,
          );
          const [count] = await owner.client.unsafe(`select count(*)::int n from app.${table}`);
          if (Number(count!["n"]) > 0)
            for (const sql of [`delete from app.${table}`, `update app.${table} set id=id`])
              await assert.rejects(owner.client.unsafe(sql), Error, `owner ${table}: ${sql}`);
        }
      },
    );

    await t.test("hostile search_path cannot hijack SECURITY DEFINER functions", async () => {
      const rows = await runtime.client.begin(async (tx) => {
        await tx`select set_config('cape.user_id',${a},true)`;
        await tx`select set_config('search_path','pg_temp, public, app',true)`;
        return tx`select app.is_approver() approver, app.is_reviewer() reviewer, app.has_consent('repository') consent`;
      });
      assert.equal(rows[0]!["approver"], false);
      assert.equal(rows[0]!["reviewer"], false);
    });

    await t.test("revocation takes effect immediately without a new login", async () => {
      const temp = await seed("temp-approver", "approved", ["approver"]);
      assert.equal((await as(temp, (tx) => tx`select app.is_approver() ok`))[0]!["ok"], true);
      await owner.client`update app.role_assignments set revoked_at=now() where user_id=${temp} and role='approver'`;
      assert.equal((await as(temp, (tx) => tx`select app.is_approver() ok`))[0]!["ok"], false);
      await assert.rejects(as(temp, (tx) => tx`select app.registration_list('pending','',1)`));
      await owner.client`update app.clergy_profiles set approval_status='suspended' where user_id=${temp}`.catch(
        () => undefined,
      );
    });

    await t.test(
      "F-02 remediation: Bouncer never claims or reserves a confidential resource's PDF",
      async () => {
        const worker = await connectLocalScanner();
        try {
          const stage = async (confidentialFlag: boolean) => {
            const parent = String(
              (
                await as(
                  a,
                  (tx) =>
                    tx`select app.save_draft(null,0,'document','Synthetic private title','General','A meaningful description for this synthetic theological proposal.',array[]::text[],false) id`,
                )
              )[0]!["id"],
            );
            const id = randomUUID();
            await owner.client`insert into app.documents(id,submission_id,storage_key,file_name,media_type,byte_size,upload_request_id)
              values(${id},${parent},${randomUUID()},'synthetic.pdf','application/pdf',0,${randomUUID()})`;
            await as(a, (tx) => tx`select app.finalize_document(${id},100,${"a".repeat(64)})`);
            if (confidentialFlag)
              await owner.client`update app.submissions set confidential=true where id=${parent}`;
            return id;
          };
          const secret = await stage(true);
          const ordinary = await stage(false);
          // Only the confidential row is eligible-looking first; it must be skipped, never claimed.
          const [none] = await worker.client`select app.claim_bouncer_scan(${secret}) as claim`;
          assert.equal(
            none!["claim"],
            null,
            "confidential PDF must not be claimed for the external provider",
          );
          const [state] =
            await owner.client`select d.state, j.provider_status, j.external_scan_id, app.document_is_clean(d.id) clean
            from app.documents d join app.document_scans j on j.document_id=d.id where d.id=${secret}`;
          assert.equal(state!["external_scan_id"], null);
          assert.equal(state!["clean"], false, "withheld document never becomes clean");
          assert.equal(state!["state"], "quarantined");
          const [ok] = await worker.client`select app.claim_bouncer_scan(${ordinary}) as claim`;
          assert.ok(ok!["claim"], "non-confidential documents keep the existing Bouncer path");
          // Defence in depth: a resource flipped to confidential after claim cannot be reserved.
          const claimed = ok!["claim"] as { lease: string };
          await owner.client`update app.submissions set confidential=true where id=(select submission_id from app.documents where id=${ordinary})`;
          await assert.rejects(
            worker.client`select app.reserve_bouncer_scan(${ordinary},${claimed.lease},0,100,${new Date().toISOString().slice(0, 7)})`,
            { code: "42501" },
          );
          await worker.client`select app.finish_bouncer_scan(${ordinary},${claimed.lease},null,'ineligible',null,null,null,false)`;
        } finally {
          await worker.close();
        }
      },
    );

    await t.test(
      "F-01 independent reviewer activation and confidential assignment guards are installed",
      async () => {
        const [guard] = await owner.client`select
       position('''grant'',''revoke'',''invite''' in prosrc)>0 as safe
       from pg_proc where oid='app.manage_access(text,text,text,text,text,text,uuid,uuid,text,text)'::regprocedure`;
        assert.equal(guard?.["safe"], true);
      },
    );
  } finally {
    await runtime.close?.();
    await owner.close();
  }
});
