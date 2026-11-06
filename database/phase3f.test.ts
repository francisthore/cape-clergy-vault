import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";
import { connectLocalScanner } from "./scanner.server.ts";
import { LocalPrivateStorageProvider } from "../src/lib/documents/storage.server.ts";
import { runScanWorker } from "../src/lib/scanning/worker.server.ts";
import { TestScanner } from "../src/lib/scanning/testing.ts";
import type { ScanClaim } from "../src/lib/scanning/worker.server.ts";

test("Phase 3F quarantine with restricted runtime and scanner roles", async (t) => {
  const owner = await connectLocalDatabase(),
    runtime = await connectLocalRuntime(),
    worker = await connectLocalScanner();
  const root = await mkdtemp(join(tmpdir(), "cape-scan-")),
    storage = new LocalPrivateStorageProvider(root),
    who = "p3f-scan-" + randomUUID(),
    submission = randomUUID();
  const pdf = Buffer.from("%PDF-1.4\nDisposable scanner fixture\n%%EOF\n");
  const as = <T>(fn: (tx: import("postgres").TransactionSql) => Promise<T>) =>
    runtime.client.begin(async (tx) => {
      await tx`select set_config('cape.user_id',${who},true)`;
      return fn(tx);
    });
  const state = async (id: string) => {
    const [r] = await owner.client`select state from app.documents where id=${id}`;
    return r!["state"];
  };
  async function upload() {
    const id = randomUUID(),
      key = randomUUID();
    await as(
      (tx) =>
        tx`insert into app.documents(id,submission_id,storage_key,file_name,media_type,byte_size) values(${id},${submission},${key},'fixture.pdf','application/pdf',0)`,
    );
    const saved = await storage.save(key, new Response(pdf).body!, new AbortController().signal);
    await as((tx) => tx`select app.finalize_document(${id},${saved.byteSize},${saved.sha256})`);
    return { id, key, ...saved };
  }
  const claim = async (id: string) => {
    const [r] = await worker.client`select app.claim_document_scan(${id}) as claim`;
    return r!["claim"] as ScanClaim | null;
  };
  const finish = (c: ScanClaim, checksum = c.sha256, time = new Date()) =>
    worker.client`select app.finish_document_scan(${c.documentId},${c.lease},'clean',${checksum},'TestScanner','fixture',${time},null) as finished`;
  try {
    await owner.client`insert into auth.users(id,name,email,email_verified) values(${who},'Scan fixture',${who + "@example.invalid"},true)`;
    await owner.client`insert into app.clergy_profiles(user_id,full_name,approval_status) values(${who},'Scan fixture','approved')`;
    await owner.client`insert into app.role_assignments(user_id,role) values(${who},'clergy')`;
    await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${who},'repository-v1','repository','accepted')`;
    await owner.client`insert into app.submissions(id,owner_id,title,status,abstract) values(${submission},${who},'Scan fixture','draft','A meaningful disposable description for scanner testing')`;
    await t.test(
      "upload quarantines; UI-independent submit and audited byte access denied",
      async () => {
        const d = await upload();
        assert.equal(await state(d.id), "quarantined");
        await assert.rejects(
          as((tx) => tx`select app.transition_submission(${submission},1,'submit')`),
          { code: "22023" },
        );
        await assert.rejects(
          as((tx) => tx`select app.record_document_access(${d.id},'started',${randomUUID()})`),
          { code: "42501" },
        );
      },
    );
    await t.test(
      "web runtime cannot claim, finalize a scan, forge a clean state or alter evidence",
      async () => {
        const d = await upload();
        for (const fn of [
          () => as((tx) => tx`select app.claim_document_scan(${d.id})`),
          () =>
            as(
              (tx) =>
                tx`select app.finish_document_scan(${d.id},${randomUUID()},'clean',${d.sha256},'Fake','fake',now(),null)`,
            ),
          () => as((tx) => tx`update app.documents set state='available' where id=${d.id}`),
          () =>
            as(
              (tx) =>
                tx`insert into app.document_scans(document_id,expected_sha256) values(${d.id},${d.sha256})`,
            ),
        ])
          await assert.rejects(fn(), { code: "42501" });
        await assert.rejects(worker.client`select * from auth.users`, { code: "42501" });
        await assert.rejects(
          worker.client`update app.documents set state='available' where id=${d.id}`,
          { code: "42501" },
        );
      },
    );
    await t.test("clean exact bytes promote once; scan event history is immutable", async () => {
      const d = await upload();
      assert.deepEqual(await runScanWorker(worker.client, storage, new TestScanner(), 1, d.id), {
        claimed: 1,
        completed: 1,
      });
      assert.equal(await state(d.id), "available");
      assert.deepEqual(await runScanWorker(worker.client, storage, new TestScanner(), 1, d.id), {
        claimed: 0,
        completed: 0,
      });
      await as((tx) => tx`select app.record_document_access(${d.id},'started',${randomUUID()})`);
      await assert.rejects(
        owner.client`delete from app.document_scan_events where document_id=${d.id}`,
        { code: "55000" },
      );
    });
    await t.test("infected never promotes or authorizes downloads", async () => {
      const d = await upload();
      await runScanWorker(
        worker.client,
        storage,
        new TestScanner({ verdict: "infected" }),
        1,
        d.id,
      );
      assert.equal(await state(d.id), "infected");
      await assert.rejects(
        as((tx) => tx`select app.record_document_access(${d.id},'authorized',${randomUUID()})`),
        { code: "42501" },
      );
    });
    await t.test(
      "unavailable, timeout, crash, malformed response and missing/stale definitions remain quarantined",
      async () => {
        for (const category of [
          "unavailable",
          "timeout",
          "disconnected",
          "invalid_response",
          "definitions_missing",
          "definitions_stale",
        ] as const) {
          const d = await upload();
          await runScanWorker(
            worker.client,
            storage,
            new TestScanner({ verdict: "error", category }),
            1,
            d.id,
          );
          assert.equal(await state(d.id), "quarantined");
        }
      },
    );
    await t.test("scan size-limit error is terminal and unavailable", async () => {
      const d = await upload();
      await runScanWorker(
        worker.client,
        storage,
        new TestScanner({ verdict: "error", category: "size_limit" }),
        1,
        d.id,
      );
      assert.equal(await state(d.id), "scan_failed");
    });
    await t.test("modified and missing objects fail closed", async () => {
      const changed = await upload();
      await writeFile(
        join(root, changed.key + ".blob"),
        Buffer.from(pdf.toString().replace("Disposable", "Altered___")),
        { mode: 0o600 },
      );
      await runScanWorker(worker.client, storage, new TestScanner(), 1, changed.id);
      assert.equal(await state(changed.id), "scan_failed");
      const missing = await upload();
      await unlink(join(root, missing.key + ".blob"));
      await runScanWorker(worker.client, storage, new TestScanner(), 1, missing.id);
      assert.equal(await state(missing.id), "scan_failed");
    });
    await t.test("infection evidence survives exclusion during scanner I/O", async () => {
      const d = await upload();
      const scanner = new TestScanner({ verdict: "infected" });
      await runScanWorker(
        worker.client,
        storage,
        {
          ...scanner,
          name: scanner.name,
          health: scanner.health.bind(scanner),
          scan: async (bytes, signal) => {
            const result = await scanner.scan(bytes);
            await owner.client`update app.documents set excluded=true where id=${d.id}`;
            void signal;
            return result;
          },
        },
        1,
        d.id,
      );
      assert.equal(await state(d.id), "infected");
    });
    await t.test(
      "global concurrency bounds two live leases across worker connections",
      async () => {
        const one = await upload(),
          two = await upload(),
          three = await upload();
        const c1 = await claim(one.id),
          c2 = await claim(two.id);
        assert.ok(c1);
        assert.ok(c2);
        assert.equal(await claim(three.id), null);
        await finish(c1);
        const c3 = await claim(three.id);
        assert.ok(c3);
        await finish(c2);
        await finish(c3);
        await assert.rejects(worker.client`select app.claim_document_scan_internal(${three.id})`, {
          code: "42501",
        });
      },
    );
    await t.test("exclusion and consent withdrawal during scanning prevent promotion", async () => {
      const excluded = await upload(),
        c = await claim(excluded.id);
      assert.ok(c);
      await owner.client`update app.documents set excluded=true where id=${excluded.id}`;
      await finish(c);
      assert.equal(await state(excluded.id), "scan_failed");
      const withdrawn = await upload(),
        w = await claim(withdrawn.id);
      assert.ok(w);
      await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${who},'repository-v1','repository','withdrawn')`;
      await finish(w);
      assert.equal(await state(withdrawn.id), "scan_failed");
      await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${who},'repository-v1','repository','accepted')`;
    });
    await t.test(
      "duplicate claims do not overlap; expired lease recovers after worker restart",
      async () => {
        const d = await upload();
        const c = await claim(d.id);
        assert.ok(c);
        assert.equal(await claim(d.id), null);
        await owner.client`update app.document_scans set lease_until=now()-interval '1 second' where document_id=${d.id}`;
        const next = await claim(d.id);
        assert.ok(next);
        assert.notEqual(next.lease, c.lease);
        assert.equal((await finish(c))[0]!["finished"], false);
        const results = await Promise.all([finish(next), finish(next)]);
        assert.equal(results.filter((r) => r[0]!["finished"]).length, 1);
      },
    );
    await t.test(
      "crash after scan before promotion leaves quarantine; lost DB connection cannot promote",
      async () => {
        const d = await upload();
        await claim(d.id);
        assert.equal(await state(d.id), "scanning");
        const disconnected = await connectLocalScanner();
        await disconnected.close();
        await assert.rejects(
          runScanWorker(disconnected.client, storage, new TestScanner(), 1, d.id),
        );
        assert.equal(await state(d.id), "scanning");
        await owner.client`update app.document_scans set lease_until=now()-interval '1 second' where document_id=${d.id}`;
        await runScanWorker(worker.client, storage, new TestScanner(), 1, d.id);
        assert.equal(await state(d.id), "available");
      },
    );
    await t.test("mismatched verdict hash and stale evidence are rejected by SQL", async () => {
      const d = await upload(),
        c = await claim(d.id);
      assert.ok(c);
      await finish(c, "0".repeat(64));
      assert.equal(await state(d.id), "scan_failed");
      const stale = await upload(),
        sc = await claim(stale.id);
      assert.ok(sc);
      await finish(sc, sc.sha256, new Date(Date.now() - 96 * 3600000));
      assert.equal(await state(stale.id), "quarantined");
    });
    await t.test(
      "five failures exhaust retries; final crashed lease exhausts on restart",
      async () => {
        const d = await upload();
        for (let i = 0; i < 5; i++) {
          await owner.client`update app.document_scans set available_at=now() where document_id=${d.id}`;
          await runScanWorker(
            worker.client,
            storage,
            new TestScanner({ verdict: "unavailable", category: "unavailable" }),
            1,
            d.id,
          );
        }
        assert.equal(await state(d.id), "scan_failed");
        assert.equal(await claim(d.id), null);
        const last = await upload();
        await owner.client`update app.document_scans set attempts=4 where document_id=${last.id}`;
        await claim(last.id);
        await owner.client`update app.document_scans set lease_until=now()-interval '1 second' where document_id=${last.id}`;
        assert.equal(await claim(last.id), null);
        assert.equal(await state(last.id), "scan_failed");
      },
    );
    await t.test(
      "legacy available record without scan evidence cannot authorize bytes",
      async () => {
        const id = randomUUID();
        await owner.client`insert into app.documents(id,submission_id,storage_key,file_name,media_type,byte_size,sha256,state) values(${id},${submission},${randomUUID()},'legacy.pdf','application/pdf',20,${"0".repeat(64)},'available')`;
        await assert.rejects(
          as((tx) => tx`select app.record_document_access(${id},'authorized',${randomUUID()})`),
          { code: "42501" },
        );
      },
    );
    await t.test(
      "explicit legacy reconciliation queues a real object without automatic promotion",
      async () => {
        const id = randomUUID(),
          key = randomUUID();
        const saved = await storage.save(
          key,
          new Response(pdf).body!,
          new AbortController().signal,
        );
        await owner.client`insert into app.documents(id,submission_id,storage_key,file_name,media_type,byte_size,sha256,state) values(${id},${submission},${key},'legacy.pdf','application/pdf',${saved.byteSize},${saved.sha256},'legacy_unscanned')`;
        assert.equal(await claim(id), null);
        await assert.rejects(
          as((tx) => tx`select app.queue_legacy_document_scan(${id},${"QUARANTINE " + id})`),
          { code: "42501" },
        );
        await assert.rejects(
          owner.client`select app.queue_legacy_document_scan(${id},'wrong confirmation')`,
          { code: "42501" },
        );
        await owner.client`select app.queue_legacy_document_scan(${id},${"QUARANTINE " + id})`;
        assert.equal(await state(id), "quarantined");
        await runScanWorker(worker.client, storage, new TestScanner(), 1, id);
        assert.equal(await state(id), "available");
      },
    );
    await t.test("cancelled upload remains failed without a scan job", async () => {
      const id = randomUUID();
      await as(
        (tx) =>
          tx`insert into app.documents(id,submission_id,storage_key,file_name,media_type,byte_size) values(${id},${submission},${randomUUID()},'cancel.pdf','application/pdf',0)`,
      );
      await as((tx) => tx`select app.fail_document(${id})`);
      assert.equal(await state(id), "failed");
      assert.equal(await claim(id), null);
    });
  } finally {
    await owner.client.begin(async (tx) => {
      for (const table of ["document_scan_events", "audit_events", "popia_consent_events"])
        await tx.unsafe(`alter table app.${table} disable trigger user`);
      await tx`delete from app.document_scan_events where document_id in(select id from app.documents where submission_id=${submission})`;
      await tx`delete from app.document_scans where document_id in(select id from app.documents where submission_id=${submission})`;
      await tx`delete from app.audit_events where submission_id=${submission} or actor_id=${who}`;
      await tx`delete from app.documents where submission_id=${submission}`;
      await tx`delete from app.submissions where id=${submission}`;
      await tx`delete from app.popia_consent_events where user_id=${who}`;
      await tx`delete from app.role_assignments where user_id=${who}`;
      await tx`delete from app.clergy_profiles where user_id=${who}`;
      await tx`delete from auth.users where id=${who}`;
      for (const table of ["document_scan_events", "audit_events", "popia_consent_events"])
        await tx.unsafe(`alter table app.${table} enable trigger user`);
    });
    await worker.close();
    await runtime.close();
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});
