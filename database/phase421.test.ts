import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";
import { connectLocalScanner } from "./scanner.server.ts";
import { readDisposableManifest, assertDisposableDatabase } from "./disposable-phase41b.server.ts";
import { acquireWorkerLock } from "../scripts/worker-lock.ts";

test("Phase 4.2.1 owner-safe verification, unchanged gates and CLI locks", async (t) => {
  const manifest = await readDisposableManifest();
  const owner = await connectLocalDatabase(),
    runtime = await connectLocalRuntime(),
    scanner = await connectLocalScanner();
  await assertDisposableDatabase(owner.client, manifest);
  const who = "p421-" + randomUUID(),
    stranger = "p421-other-" + randomUUID();
  const as = <T>(identity: string, work: (tx: TransactionSql) => Promise<T>) =>
    runtime.client.begin(async (tx) => {
      await tx`select set_config('cape.user_id',${identity},true)`;
      return work(tx);
    });
  const hash = createHash("sha256")
    .update("%PDF-1.4\nDisposable harmless PDF\n%%EOF\n")
    .digest("hex");
  let sub = "";
  const upload = async () => {
    const id = randomUUID();
    await as(
      who,
      (tx) =>
        tx`insert into app.documents(id,submission_id,storage_key,file_name,media_type,byte_size) values(${id},${sub},${randomUUID()},'synthetic.pdf','application/pdf',0)`,
    );
    await as(who, (tx) => tx`select app.finalize_document(${id},43,${hash})`);
    return id;
  };
  const status = async (id: string, identity = who) =>
    (await as(identity, (tx) => tx`select app.owner_document_verification(${id}) value`))[0]![
      "value"
    ];
  const due = (id: string) =>
    owner.client`update app.document_scans set available_at=now() where document_id=${id}`;
  try {
    for (const id of [who, stranger]) {
      await owner.client`insert into auth.users(id,name,email,email_verified) values(${id},'Synthetic clergy',${id + "@example.invalid"},true)`;
      await owner.client`insert into app.clergy_profiles(user_id,full_name,title,parish,approval_status) values(${id},'Synthetic clergy','Rev.','Synthetic parish','approved')`;
      await owner.client`insert into app.role_assignments(user_id,role) values(${id},'clergy')`;
      await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${id},'repository-v1','repository','accepted')`;
    }
    sub = String(
      (
        await as(
          who,
          (tx) =>
            tx`select app.save_draft(null,0,'document','Synthetic resource','General','A meaningful theological description for a disposable test.',array[]::text[],false) id`,
        )
      )[0]!["id"],
    );
    const doc = await upload();
    await t.test(
      "queued projection reveals only a fixed status, never worker evidence",
      async () => {
        assert.equal(await status(doc), "waiting");
        assert.equal(await status(doc, stranger), null);
        assert.equal(await status(randomUUID()), null);
        await assert.rejects(
          as(who, (tx) => tx`select * from app.document_scans`),
          { code: "42501" },
        );
        await assert.rejects(
          as(who, (tx) => tx`select app.claim_document_scan(${doc})`),
          { code: "42501" },
        );
        await assert.rejects(
          as(who, (tx) => tx`select app.transition_submission(${sub},1,'submit')`),
          { code: "22023" },
        );
      },
    );
    await t.test(
      "active lease, retry and clean evidence map truthfully; status does not bypass download gates",
      async () => {
        let claim = (await scanner.client`select app.claim_document_scan(${doc}) c`)[0]!["c"];
        assert.ok(claim);
        assert.equal(await status(doc), "checking");
        await scanner.client`select app.finish_document_scan(${doc},${claim.lease},'unavailable',null,null,null,null,'unavailable')`;
        assert.equal(await status(doc), "delayed");
        await due(doc);
        claim = (await scanner.client`select app.claim_document_scan(${doc}) c`)[0]!["c"];
        await scanner.client`select app.finish_document_scan(${doc},${claim.lease},'clean',${hash},'Synthetic ClamAV','Synthetic definitions',now(),null)`;
        assert.equal(await status(doc), "ready");
        assert.equal(
          (await as(who, (tx) => tx`select app.document_is_clean(${doc}) c`))[0]!["c"],
          true,
        );
      },
    );
    const bouncer = await upload();
    await t.test(
      "Bouncer pending stays waiting, reported scanning is active, terminal failure stays blocked",
      async () => {
        let claim = (await scanner.client`select app.claim_bouncer_scan(${bouncer}) c`)[0]!["c"];
        assert.ok(claim);
        assert.equal(await status(bouncer), "waiting");
        const period = new Date().toISOString().slice(0, 7);
        assert.equal(
          (
            await scanner.client`select app.reserve_bouncer_scan(${bouncer},${claim.lease},0,500,${period}) ok`
          )[0]!["ok"],
          true,
        );
        const scanId = "scan_" + randomUUID();
        await scanner.client`select app.accept_bouncer_scan(${bouncer},${claim.lease},${scanId})`;
        await scanner.client`select app.finish_bouncer_scan(${bouncer},${claim.lease},${scanId},'submitted',null,null,null,false)`;
        assert.equal(await status(bouncer), "waiting");
        await due(bouncer);
        claim = (await scanner.client`select app.claim_bouncer_scan(${bouncer}) c`)[0]!["c"];
        await scanner.client`select app.finish_bouncer_scan(${bouncer},${claim.lease},${scanId},'scanning',null,null,null,true)`;
        assert.equal(await status(bouncer), "checking");
        await due(bouncer);
        claim = (await scanner.client`select app.claim_bouncer_scan(${bouncer}) c`)[0]!["c"];
        await scanner.client`select app.finish_bouncer_scan(${bouncer},${claim.lease},${scanId},'failed',null,null,null,true)`;
        assert.equal(await status(bouncer), "unsuccessful");
        await assert.rejects(
          as(who, (tx) => tx`select app.transition_submission(${sub},1,'submit')`),
          { code: "22023" },
        );
        await as(who, (tx) => tx`select app.exclude_draft_document(${bouncer},1)`);
        assert.equal(await status(bouncer), "excluded");
      },
    );
    await t.test(
      "CLI locks refuse concurrent batches and release without altering queue leases",
      async () => {
        const release = await acquireWorkerLock(scanner.client, "scanner");
        try {
          await assert.rejects(acquireWorkerLock(scanner.client, "scanner"), /already running/);
        } finally {
          await release();
        }
        await (
          await acquireWorkerLock(scanner.client, "scanner")
        )();
      },
    );
    await t.test(
      "revoked consent immediately hides status while retaining audit history",
      async () => {
        const before = (
          await owner.client`select count(*)::int n from app.document_scan_events where document_id=${doc}`
        )[0]!["n"];
        await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${who},'repository-v1','repository','withdrawn')`;
        assert.equal(await status(doc), null);
        assert.equal(
          (
            await owner.client`select count(*)::int n from app.document_scan_events where document_id=${doc}`
          )[0]!["n"],
          before,
        );
      },
    );
  } finally {
    await scanner.close();
    await runtime.close();
    await owner.close();
  }
});
