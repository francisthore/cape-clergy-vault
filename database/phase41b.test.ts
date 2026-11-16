import assert from "node:assert/strict";
import { auditFixtureState } from "./test-fixture-audit.ts";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";
import { connectLocalScanner } from "./scanner.server.ts";
import { readDisposableManifest, assertDisposableDatabase } from "./disposable-phase41b.server.ts";
import { LocalPrivateStorageProvider } from "../src/lib/documents/storage.server.ts";
import { BouncerScanner } from "../src/lib/scanning/bouncer.server.ts";
import { runScanWorker, type ScanClaim } from "../src/lib/scanning/worker.server.ts";

test("Phase 4.1B actual restricted roles, durable asynchronous Bouncer and provider evidence", async (t) => {
  const manifest = await readDisposableManifest();
  const owner = await connectLocalDatabase(),
    runtime = await connectLocalRuntime(),
    worker = await connectLocalScanner();
  await assertDisposableDatabase(owner.client, manifest);
  const root = await mkdtemp(join(tmpdir(), "cape-bouncer-")),
    storage = new LocalPrivateStorageProvider(root);
  const who = "p41b-" + randomUUID(),
    sub = randomUUID();
  const period = new Date().toISOString().slice(0, 7);
  const pdf = Buffer.from("%PDF-1.4\nDisposable Bouncer lifecycle fixture\n%%EOF\n");
  const as = <T>(fn: (tx: import("postgres").TransactionSql) => Promise<T>) =>
    runtime.client.begin(async (tx) => {
      await tx`select set_config('cape.user_id',${who},true)`;
      return fn(tx);
    });
  async function upload(bytes = pdf) {
    const id = randomUUID(),
      key = randomUUID();
    await as(
      (tx) =>
        tx`insert into app.documents(id,submission_id,storage_key,file_name,media_type,byte_size) values(${id},${sub},${key},'fixture.pdf','application/pdf',0)`,
    );
    const saved = await storage.save(key, new Response(bytes).body!, AbortSignal.timeout(5000));
    await as((tx) => tx`select app.finalize_document(${id},${saved.byteSize},${saved.sha256})`);
    return { id, key, ...saved };
  }
  const row = async (id: string) =>
    (
      await owner.client`select j.*,d.state as document_state,app.document_is_clean(d.id) as clean from app.document_scans j join app.documents d on d.id=j.document_id where d.id=${id}`
    )[0]!;
  const due = (id: string) =>
    owner.client`update app.document_scans set available_at=now() where document_id=${id}`;
  type Claim = ScanClaim & { externalScanId: string | null };
  const claim = async (id: string) =>
    (await worker.client`select app.claim_bouncer_scan(${id}) as claim`)[0]![
      "claim"
    ] as Claim | null;
  const finish = (
    c: Claim,
    result = "clean",
    hash: string | null = c.sha256,
    size = c.byteSize,
    id = c.externalScanId,
  ) =>
    worker.client`select app.finish_bouncer_scan(${c.documentId},${c.lease},${id},${result},${hash},${hash},${size},true) as ok`;
  const reserve = (c: Claim) =>
    worker.client`select app.reserve_bouncer_scan(${c.documentId},${c.lease},0,500,${period}) as ok`;
  async function accepted(c: Claim) {
    assert.equal((await reserve(c))[0]!["ok"], true);
    const id = "scan_" + randomUUID();
    assert.equal(
      (
        await worker.client`select app.accept_bouncer_scan(${c.documentId},${c.lease},${id}) as ok`
      )[0]!["ok"],
      true,
    );
    c.externalScanId = id;
  }
  function provider(hash: string, size: number, outcome = "clean") {
    let posts = 0,
      polls = 0,
      used = 0;
    const scanner = new BouncerScanner({
      apiKey: "fixture-private-key",
      uploadHost: "",
      fetch: (async (input, init) => {
        const url = String(input);
        if (url.endsWith("/usage")) {
          const now = new Date();
          return Response.json({
            status: "success",
            data: {
              tier: "free",
              period,
              scans_used: used,
              scans_limit: 500,
              resets_at: new Date(
                Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
              ).toISOString(),
            },
          });
        }
        if (init?.method === "POST") {
          posts++;
          for await (const _ of init.body as unknown as AsyncIterable<Uint8Array>) {
            void _;
          }
          return Response.json(
            { status: "success", data: { scan_id: "scan_" + randomUUID(), status: "pending" } },
            { status: 202 },
          );
        }
        polls++;
        if (outcome === "timeout") throw Error("provider unavailable");
        return Response.json({
          status: "success",
          data: {
            scan_id: url.split("/").at(-1),
            status: outcome === "pending" ? "pending" : "completed",
            verdict: outcome,
            file: { sha256: hash, size },
          },
        });
      }) as typeof fetch,
    });
    return {
      scanner,
      posts: () => posts,
      polls: () => polls,
      quota: () => {
        used = 500;
      },
    };
  }
  try {
    await t.test(
      "audits retain nonempty history and owner mutation/truncate remains blocked",
      async () => {
        await owner.client`insert into app.audit_events(actor_id,action,outcome) values
        (${"p41b-" + randomUUID()},'document.download.started','ok'),
        ('retained-operator-fixture','test.audit.retention','ok')`;
        const snapshot = () => owner.client`select * from app.audit_events order by id`;
        const before = await snapshot();
        const result = await auditFixtureState(owner.client);
        assert.equal(result.retainedHistory["audit_events"], 2);
        for (const operation of [
          () => owner.client`delete from app.audit_events where id=${before[0]!["id"]}`,
          () =>
            owner.client`update app.audit_events set action='changed' where id=${before[0]!["id"]}`,
          () => owner.client`truncate app.audit_events`,
        ])
          await assert.rejects(operation(), { code: "55000" });
        assert.deepEqual(await snapshot(), before);
      },
    );
    await t.test(
      "fixture-scoped audit rejects leaked identities, including opaque auth IDs",
      async () => {
        for (const opaque of [false, true]) {
          const fixture = "phase3e-" + randomUUID() + "-author";
          await assert.rejects(
            owner.client.begin(async (tx) => {
              await tx`insert into auth.users(id,name,email,email_verified) values(${opaque ? "opaque-" + randomUUID() : fixture},'Disposable fixture',${fixture + "@example.invalid"},true)`;
              await auditFixtureState(tx);
            }),
            /Live disposable fixture remains: identities/,
          );
        }
      },
    );
    await owner.client`insert into auth.users(id,name,email,email_verified) values(${who},'Bouncer fixture',${who + "@example.invalid"},true)`;
    await owner.client`insert into app.clergy_profiles(user_id,full_name,approval_status) values(${who},'Bouncer fixture','approved')`;
    await owner.client`insert into app.role_assignments(user_id,role) values(${who},'clergy')`;
    await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${who},'repository-v1','repository','accepted')`;
    await owner.client`insert into app.submissions(id,owner_id,title,status,abstract) values(${sub},${who},'Bouncer fixture','draft','A meaningful disposable scanner description')`;
    await t.test(
      "web cannot claim/reserve/accept/finish, select evidence or budget; scanner cannot write tables",
      async () => {
        for (const query of [
          () => as((tx) => tx`select app.claim_bouncer_scan(null)`),
          () =>
            as(
              (tx) =>
                tx`select app.reserve_bouncer_scan(${randomUUID()},${randomUUID()},0,500,${period})`,
            ),
          () =>
            as(
              (tx) =>
                tx`select app.accept_bouncer_scan(${randomUUID()},${randomUUID()},'scan_fake')`,
            ),
          () =>
            as(
              (tx) =>
                tx`select app.finish_bouncer_scan(${randomUUID()},${randomUUID()},'scan_fake','clean',null,null,20,true)`,
            ),
          () => as((tx) => tx`select * from app.document_scans`),
          () => as((tx) => tx`select * from app.scanner_budget`),
          () => worker.client`update app.document_scans set state='clean'`,
          () => worker.client`update app.scanner_budget set reserved=0`,
        ])
          await assert.rejects(query(), { code: "42501" });
      },
    );
    await t.test(
      "acceptance commits ID; restart polls once, verifies clean bytes, no fake definitions",
      async () => {
        const d = await upload(),
          p = provider(d.sha256, d.byteSize);
        await runScanWorker(worker.client, storage, p.scanner, 1, d.id);
        const saved = await row(d.id);
        assert.equal(saved["document_state"], "quarantined");
        assert.ok(saved["external_scan_id"]);
        const restarted = await connectLocalScanner();
        try {
          await due(d.id);
          await runScanWorker(restarted.client, storage, p.scanner, 1, d.id);
        } finally {
          await restarted.close();
        }
        const done = await row(d.id);
        assert.equal(done["document_state"], "available");
        assert.equal(done["clean"], true);
        assert.equal(done["engine"], null);
        assert.equal(done["definitions_at"], null);
        assert.equal(p.posts(), 1);
        assert.equal(p.polls(), 1);
        await assert.rejects(
          owner.client`delete from app.document_scan_events where document_id=${d.id}`,
          { code: "55000" },
        );
        // SQL authorization probe only: no bytes are transferred, so roll the fixture
        // transaction back instead of leaving a committed synthetic download history.
        const rollback = new Error("Rollback disposable authorization probe");
        await assert.rejects(
          as(async (tx) => {
            await tx`select app.record_document_access(${d.id},'started',${randomUUID()})`;
            throw rollback;
          }),
          (error) => error === rollback,
        );
      },
    );
    await t.test("lost acknowledgement after committed ID leaves lease recoverable", async () => {
      const d = await upload(),
        p = provider(d.sha256, d.byteSize);
      const uncertain = new Proxy(worker.client, {
        apply(target, thisArg, args) {
          const query = Reflect.apply(target, thisArg, args);
          if ((args[0] as TemplateStringsArray).join("").includes("app.accept_bouncer_scan"))
            return Promise.resolve(query).then(() => {
              throw Error("Simulated lost commit acknowledgement");
            });
          return query;
        },
      });
      await assert.rejects(runScanWorker(uncertain, storage, p.scanner, 1, d.id));
      assert.ok((await row(d.id))["external_scan_id"]);
      assert.equal((await row(d.id))["document_state"], "scanning");
      await owner.client`update app.document_scans set lease_until=now()-interval '1 second' where document_id=${d.id}`;
      await runScanWorker(worker.client, storage, p.scanner, 1, d.id);
      assert.equal((await row(d.id))["document_state"], "available");
      assert.equal(p.posts(), 1);
    });
    await t.test(
      "exact 20 MiB v2 upload commits ID before S3 and resumes verified polling",
      async () => {
        const bytes = Buffer.alloc(20 * 1024 * 1024, 32);
        bytes.write("%PDF-1.7\n");
        bytes.write("\n%%EOF\n", bytes.length - 7);
        const d = await upload(bytes),
          host = "bouncer-dev-uploads-fixture.s3.ap-south-1.amazonaws.com";
        const scanId = "scan_" + randomUUID();
        let posts = 0,
          uploads = 0;
        const scanner = new BouncerScanner({
          apiKey: "fixture-private-key",
          uploadHost: host,
          fetch: (async (input, init) => {
            const url = String(input),
              now = new Date();
            let data: unknown;
            if (url.endsWith("/usage"))
              data = {
                tier: "free",
                period,
                scans_used: 0,
                scans_limit: 500,
                resets_at: new Date(
                  Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
                ).toISOString(),
              };
            else if (url.endsWith("/v2/scan")) {
              posts++;
              data = {
                scan_id: scanId,
                status: "pending",
                max_file_size: 26214400,
                upload: {
                  url: `https://${host}/`,
                  fields: { key: `uploads/${scanId}/document.pdf`, policy: "fixture-policy" },
                },
              };
            } else if (url === `https://${host}/`) {
              uploads++;
              assert.equal((await row(d.id))["external_scan_id"], scanId);
              assert.equal(new Headers(init?.headers).has("X-API-Key"), false);
              for await (const chunk of init?.body as unknown as AsyncIterable<Uint8Array>)
                void chunk;
              return new Response(null, { status: 204 });
            } else
              data = {
                scan_id: scanId,
                status: "completed",
                verdict: "clean",
                file: { sha256: d.sha256, size: d.byteSize },
              };
            return Response.json(
              { status: "success", data },
              { status: url.endsWith("/v2/scan") ? 201 : 200 },
            );
          }) as typeof fetch,
        });
        await runScanWorker(worker.client, storage, scanner, 1, d.id);
        assert.equal((await row(d.id))["document_state"], "quarantined");
        await due(d.id);
        await runScanWorker(worker.client, storage, scanner, 1, d.id);
        assert.equal((await row(d.id))["document_state"], "available");
        assert.equal(posts, 1);
        assert.equal(uploads, 1);
      },
    );
    await t.test(
      "unavailable provider before submission stays quarantined with no ambiguity marker",
      async () => {
        const d = await upload();
        const scanner = new BouncerScanner({
          apiKey: "fixture-private-key",
          uploadHost: "",
          fetch: (async () => {
            throw Error("offline");
          }) as typeof fetch,
        });
        await runScanWorker(worker.client, storage, scanner, 1, d.id);
        const saved = await row(d.id);
        assert.equal(saved["document_state"], "quarantined");
        assert.equal(saved["provider_status"], "new");
        assert.equal(saved["submitted_at"], null);
        assert.equal(saved["failure_count"], 1);
        // Complete this synthetic retry so it cannot affect later independent claims.
        await due(d.id);
        const c = (await claim(d.id))!;
        await worker.client`select app.finish_bouncer_scan(${c.documentId},${c.lease},null,'ineligible',null,null,null,false)`;
      },
    );
    for (const verdict of ["malicious", "suspicious", "unknown"])
      await t.test(verdict + " cannot authorize downloads", async () => {
        const d = await upload(),
          p = provider(d.sha256, d.byteSize, verdict);
        await runScanWorker(worker.client, storage, p.scanner, 1, d.id);
        await due(d.id);
        await runScanWorker(worker.client, storage, p.scanner, 1, d.id);
        assert.equal(
          (await row(d.id))["document_state"],
          verdict === "malicious" ? "infected" : "scan_failed",
        );
        await assert.rejects(
          as((tx) => tx`select app.record_document_access(${d.id},'authorized',${randomUUID()})`),
          { code: "42501" },
        );
      });
    for (const mismatch of ["hash", "size", "local"])
      await t.test(mismatch + " integrity mismatch is terminal", async () => {
        const d = await upload(),
          p = provider(
            mismatch === "hash" ? "0".repeat(64) : d.sha256,
            d.byteSize + (mismatch === "size" ? 1 : 0),
          );
        await runScanWorker(worker.client, storage, p.scanner, 1, d.id);
        if (mismatch === "local")
          await writeFile(
            join(root, d.key + ".blob"),
            Buffer.from(pdf.toString().replace("Disposable", "Altered___")),
          );
        await due(d.id);
        await runScanWorker(worker.client, storage, p.scanner, 1, d.id);
        assert.equal((await row(d.id))["document_state"], "scan_failed");
        assert.equal((await row(d.id))["result_category"], "integrity_mismatch");
      });
    await t.test(
      "pending/retry retains ID; no repeated POST; bounded polling exhausts",
      async () => {
        const d = await upload(),
          p = provider(d.sha256, d.byteSize, "pending");
        await runScanWorker(worker.client, storage, p.scanner, 1, d.id);
        await due(d.id);
        await runScanWorker(worker.client, storage, p.scanner, 1, d.id);
        assert.equal((await row(d.id))["provider_status"], "pending");
        assert.equal(p.posts(), 1);
        await owner.client`update app.document_scans set poll_count=119,available_at=now() where document_id=${d.id}`;
        await runScanWorker(worker.client, storage, p.scanner, 1, d.id);
        assert.equal((await row(d.id))["document_state"], "scan_failed");
      },
    );
    await t.test("post-acceptance outage resumes same scan; five failures exhaust", async () => {
      const d = await upload(),
        p = provider(d.sha256, d.byteSize, "timeout");
      await runScanWorker(worker.client, storage, p.scanner, 1, d.id);
      for (let i = 0; i < 5; i++) {
        await due(d.id);
        await runScanWorker(worker.client, storage, p.scanner, 1, d.id);
      }
      assert.equal(p.posts(), 1);
      assert.equal((await row(d.id))["document_state"], "scan_failed");
    });
    await t.test("crash with ambiguous submission never repeats POST", async () => {
      const d = await upload(),
        c = (await claim(d.id))!;
      await reserve(c);
      await owner.client`update app.document_scans set lease_until=now()-interval '1 second' where document_id=${d.id}`;
      const p = provider(d.sha256, d.byteSize);
      await runScanWorker(worker.client, storage, p.scanner, 1, d.id);
      assert.equal(p.posts(), 0);
      assert.equal((await row(d.id))["provider_status"], "ambiguous");
    });
    await t.test(
      "crash after ID persistence recovers poll and rejects stale lease and cross-provider finalization",
      async () => {
        const d = await upload(),
          c = (await claim(d.id))!;
        await accepted(c);
        assert.equal(
          (
            await worker.client`select app.finish_document_scan(${c.documentId},${c.lease},'clean',${c.sha256},'Fake','fake',now(),null) as ok`
          )[0]!["ok"],
          false,
        );
        await owner.client`update app.document_scans set lease_until=now()-interval '1 second' where document_id=${d.id}`;
        const next = (await claim(d.id))!;
        assert.equal(next.externalScanId, c.externalScanId);
        assert.notEqual(next.lease, c.lease);
        assert.equal((await finish(c))[0]!["ok"], false);
        assert.equal((await finish(next))[0]!["ok"], true);
      },
    );
    await t.test(
      "concurrent claims and accepted pending scans enforce one external scan",
      async () => {
        const a = await upload(),
          b = await upload();
        const results = await Promise.all([claim(a.id), claim(b.id)]),
          winner = results.find(Boolean)!;
        assert.equal(results.filter(Boolean).length, 1);
        await accepted(winner);
        await worker.client`select app.finish_bouncer_scan(${winner.documentId},${winner.lease},${winner.externalScanId},'submitted',null,null,null,false)`;
        assert.equal(await claim(winner.documentId === a.id ? b.id : a.id), null);
        await due(winner.documentId);
        await finish((await claim(winner.documentId))!);
        const other = (await claim(winner.documentId === a.id ? b.id : a.id))!;
        await worker.client`select app.finish_bouncer_scan(${other.documentId},${other.lease},null,'ineligible',null,null,null,false)`;
      },
    );
    for (const revoke of ["exclude", "revision", "consent"])
      await t.test(revoke + " revocation prevents clean promotion", async () => {
        const d = await upload(),
          c = (await claim(d.id))!;
        await accepted(c);
        if (revoke === "exclude")
          await owner.client`update app.documents set excluded=true where id=${d.id}`;
        if (revoke === "revision")
          await owner.client`update app.submissions set revision=revision+1 where id=${sub}`;
        if (revoke === "consent")
          await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${who},'repository-v1','repository','withdrawn')`;
        await finish(c);
        assert.equal((await row(d.id))["document_state"], "scan_failed");
        if (revoke === "consent")
          await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${who},'repository-v1','repository','accepted')`;
      });
    await t.test(
      "missing ID, wrong scan ID and missing evidence cannot promote in SQL",
      async () => {
        for (const invalid of ["missing-id", "wrong-id", "missing-hash"]) {
          const d = await upload(),
            c = (await claim(d.id))!;
          if (invalid !== "missing-id") await accepted(c);
          await finish(
            c,
            "clean",
            invalid === "missing-hash" ? null : c.sha256,
            c.byteSize,
            invalid === "wrong-id" ? "scan_wrong" : c.externalScanId,
          );
          assert.equal((await row(d.id))["clean"], false);
        }
      },
    );
    await t.test(
      "quota exhaustion backs off all fresh scans until UTC reset without POST",
      async () => {
        const d = await upload(),
          p = provider(d.sha256, d.byteSize);
        p.quota();
        await runScanWorker(worker.client, storage, p.scanner, 1, d.id);
        assert.equal(p.posts(), 0);
        assert.equal((await row(d.id))["document_state"], "quarantined");
        assert.equal((await row(d.id))["result_category"], "quota");
        const other = await upload();
        assert.equal(await claim(other.id), null);
        await owner.client`update app.scanner_budget set blocked_until=null,reserved=500 where period=${period}`;
        const c = (await claim(other.id))!;
        assert.equal((await reserve(c))[0]!["ok"], false);
        await worker.client`select app.finish_bouncer_scan(${c.documentId},${c.lease},null,'quota',null,null,null,false)`;
      },
    );
  } finally {
    // Preserve every committed scan, consent and audit event until the verified
    // disposable cluster is stopped and its entire fresh environment is discarded.
    await Promise.all([worker.close(), runtime.close(), owner.close()]);
    await rm(root, { recursive: true, force: true });
  }
});
