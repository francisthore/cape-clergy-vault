import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { TransactionSql } from "postgres";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";
import { connectLocalScanner } from "./scanner.server.ts";
import { readDisposableManifest, assertDisposableDatabase } from "./disposable-phase41b.server.ts";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  migrationFolder,
  productionGrants,
  reviewedMigrationPlan,
} from "./migration-plan.server.ts";
import {
  auditMigrationLedger,
  auditRoles,
  auditRls,
  auditGrants,
  auditFunctions,
  auditImmutableTriggers,
} from "./security-contract.ts";
import { hashPassword } from "better-auth/crypto";
import { EmailService, TestEmailProvider } from "../src/lib/email/service.server.ts";
import { createAuthService } from "../src/lib/auth/service.server.ts";
import { createDocumentService } from "../src/lib/documents/service.server.ts";
import { LocalPrivateStorageProvider } from "../src/lib/documents/storage.server.ts";
import { MAX_PDF_BYTES } from "../src/lib/documents/validation.ts";
import {
  productionTargetSchema,
  assertProductionIdentity,
  assertPilotContract,
} from "./production.server.ts";
import { localTarget } from "./safety.ts";
import { createInvitationProof } from "../src/lib/reviews/tokens.server.ts";

test("Phase 4.3.1 independent authority and transfer concurrency", async (t) => {
  const owner = await connectLocalDatabase(),
    runtime = await connectLocalRuntime(),
    scanner = await connectLocalScanner();
  await assertDisposableDatabase(owner.client, await readDisposableManifest());
  const prefix = "p431-" + randomUUID(),
    month = new Date().toISOString().slice(0, 7);
  const as = <T>(who: string, work: (tx: TransactionSql) => Promise<T>) =>
    runtime.client.begin(async (tx) => {
      await tx`select set_config('cape.user_id',${who},true)`;
      return work(tx);
    });
  const seed = async (label: string, reviewer = false) => {
    const id = prefix + label;
    await owner.client`insert into auth.users(id,name,email,email_verified) values(${id},'Synthetic',${id + "@example.invalid"},true)`;
    await owner.client`insert into app.clergy_profiles(user_id,full_name,title,parish,approval_status) values(${id},'Synthetic','Rev.','Synthetic','approved')`;
    for (const role of reviewer ? ["clergy", "reviewer"] : ["clergy"])
      await owner.client`insert into app.role_assignments(user_id,role) values(${id},${role})`;
    await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${id},'repository-v1','repository','accepted')`;
    return id;
  };
  const draft = async (who: string, confidential = false, kind = "idea") =>
    String(
      (
        await as(
          who,
          (tx) =>
            tx`select app.save_draft(null,0,${kind},'Synthetic proposal','General','A meaningful synthetic description for theological review.',array[]::text[],${confidential}) id`,
        )
      )[0]!["id"],
    );
  const stage = async (confidential = false) => {
    const parent = await draft(author, confidential, "document"),
      id = randomUUID();
    await owner.client`insert into app.documents(id,submission_id,storage_key,file_name,media_type,byte_size,upload_request_id) values(${id},${parent},${randomUUID()},'synthetic.pdf','application/pdf',0,${randomUUID()})`;
    await as(author, (tx) => tx`select app.finalize_document(${id},100,${"a".repeat(64)})`);
    return { id, parent };
  };
  const claim = async (id: string) =>
    (await scanner.client`select app.claim_bouncer_scan(${id}) c`)[0]!["c"] as {
      lease: string;
      externalScanId: string | null;
    };
  const reserve = (id: string, lease: string) =>
    scanner.client`select app.reserve_bouncer_scan(${id},${lease},0,500,${month}) ok`;
  const release = (id: string, lease: string) =>
    scanner.client`select app.finish_bouncer_scan(${id},${lease},null,'ineligible',null,null,null,false)`;
  let author = "",
    coordinator = "",
    peer = "",
    legacyConfidential = "";
  try {
    await t.test(
      "production identity boundary rejects wrong marker/role and missing security migrations on an isolated Unix socket",
      async () => {
        const manifest = await readDisposableManifest();
        const target = productionTargetSchema.parse({
          database: "cape_clergy_vault",
          owner: "cape_clergy_dev",
          marker: "cape-clergy-vault:production:" + manifest.runId,
          transport: "unix",
          host: "/run/cape-vault/postgresql",
          port: 5432,
        });
        const credential = new URL(process.env["CAPE_RUNTIME_DATABASE_URL"]!);
        const db = postgres({
          host: manifest.root,
          port: localTarget.port,
          database: target.database,
          username: "cape_clergy_runtime",
          password: decodeURIComponent(credential.password),
          max: 1,
        });
        try {
          await assertProductionIdentity(db, target, "runtime");
          await assert.rejects(
            assertProductionIdentity(
              db,
              { ...target, marker: "cape-clergy-vault:production:" + randomUUID() },
              "runtime",
            ),
          );
          await assert.rejects(assertProductionIdentity(db, target, "scanner"));
          await assert.rejects(assertPilotContract(db));
          const ownerCredential = new URL(process.env["CAPE_DATABASE_URL"]!);
          const operator = postgres({
            host: manifest.root,
            port: localTarget.port,
            database: target.database,
            username: "cape_clergy_dev",
            password: decodeURIComponent(ownerCredential.password),
            max: 1,
          });
          try {
            await assertProductionIdentity(operator, target, "operator");
            await operator`revoke create on schema public from public`;
            await migrate(drizzle(operator), {
              migrationsFolder: migrationFolder,
              migrationsSchema: "cape_migrations",
            });
            await operator.unsafe(await productionGrants());
            assert.deepEqual((await reviewedMigrationPlan(operator)).pending, []);
            const checks: string[] = [];
            await auditMigrationLedger(operator, checks);
            await auditRoles(operator, checks);
            await auditRls(operator, checks);
            await auditGrants(operator, checks);
            await auditFunctions(operator, checks);
            await auditImmutableTriggers(operator, checks);
            await assertPilotContract(db);
          } finally {
            await operator.end();
          }
          for (const patch of [
            { database: "other_app" },
            { host: "remote.example.invalid", transport: "unix" },
            { host: "127.0.0.1", transport: "tls" },
            { host: "*.example.org", transport: "tls" },
          ])
            assert.equal(productionTargetSchema.safeParse({ ...target, ...patch }).success, false);
        } finally {
          await db.end();
        }
      },
    );
    author = await seed("author");
    coordinator = await seed("coordinator", true);
    peer = await seed("peer", true);
    for (const who of [coordinator, peer])
      await owner.client`insert into app.operational_grants(user_id,capability,delegated) values(${who},'review_coordinator',array[]::text[]),(${who},'access_manager',array['reviewer'])`;
    await t.test(
      "self-invitation and old pending self-issued proofs cannot activate; forged proof fails",
      async () => {
        const who = await seed("candidate"),
          proof = createInvitationProof("synthetic-proof-secret-with-at-least-32-characters", who);
        await owner.client`insert into app.operational_grants(user_id,capability,delegated) values(${who},'access_manager',array['reviewer'])`;
        await assert.rejects(
          as(
            who,
            (tx) =>
              tx`select app.manage_access('invite',${who},'reviewer',${who + "@example.invalid"},${"INVITE " + who + " reviewer"},'Synthetic identity independently verified',${randomUUID()},null,${proof.digest},${proof.sealed})`,
          ),
          { code: "42501" },
        );
        // Represents an unsafe invitation pending before the forward migration; no historical row is deleted.
        await owner.client`insert into app.reviewer_invitations(user_id,mailbox,token_digest,issued_by,expires_at) values(${who},${who + "@example.invalid"},${proof.digest},${who},now()+interval '1 hour')`;
        await assert.rejects(
          as(who, (tx) => tx`select app.accept_reviewer_invitation(${proof.digest})`),
          { code: "22023" },
        );
        await assert.rejects(
          as(who, (tx) => tx`select app.accept_reviewer_invitation(${"f".repeat(64)})`),
          { code: "22023" },
        );
        assert.equal((await as(who, (tx) => tx`select app.is_reviewer() ok`))[0]!["ok"], false);
        assert.equal(
          (await as(coordinator, (tx) => tx`select app.is_reviewer() ok`))[0]!["ok"],
          true,
          "existing legitimate grants survive",
        );
      },
    );
    await t.test(
      "independent confidential assignment grants only the reviewer; author and confidential self-assignment fail",
      async () => {
        const id = await draft(author, true);
        await as(author, (tx) => tx`select app.transition_submission(${id},1,'submit')`);
        await assert.rejects(
          as(
            coordinator,
            (tx) => tx`select app.coordinate_assignment(${id},1,${coordinator},${randomUUID()})`,
          ),
          { code: "42501" },
        );
        await assert.rejects(
          as(peer, (tx) => tx`select app.coordinate_assignment(${id},1,${author},${randomUUID()})`),
          { code: "40001" },
        );
        await as(
          peer,
          (tx) => tx`select app.coordinate_assignment(${id},1,${coordinator},${randomUUID()})`,
        );
        assert.equal(
          (await as(coordinator, (tx) => tx`select app.can_review_submission(${id}) ok`))[0]!["ok"],
          true,
        );
        assert.equal(
          (await as(peer, (tx) => tx`select app.can_review_submission(${id}) ok`))[0]!["ok"],
          false,
        );
      },
    );
    await t.test(
      "non-confidential self-assignment is explicit, concurrent duplicates have one winner, revoked replays fail",
      async () => {
        const id = await draft(author);
        await as(author, (tx) => tx`select app.transition_submission(${id},1,'submit')`);
        const requests = [randomUUID(), randomUUID()];
        const results = await Promise.allSettled(
          requests.map((key) =>
            as(
              coordinator,
              (tx) => tx`select app.coordinate_assignment(${id},1,${coordinator},${key}) id`,
            ),
          ),
        );
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        const index = results.findIndex((r) => r.status === "fulfilled"),
          winner = results[index]!;
        assert.equal(winner.status, "fulfilled");
        if (winner.status !== "fulfilled") throw Error("missing assignment");
        const assignment = String(winner.value[0]!["id"]);
        assert.equal(
          (
            await owner.client`select count(*)::int n from app.reviewer_events where assignment_id=${assignment} and action='assignment_created'`
          )[0]!["n"],
          1,
        );
        await as(
          peer,
          (tx) => tx`select app.coordination_revoke_assignment(${assignment},${randomUUID()})`,
        );
        await assert.rejects(
          as(
            coordinator,
            (tx) =>
              tx`select app.coordinate_assignment(${id},1,${coordinator},${requests[index]!})`,
          ),
          { code: "40001" },
        );
        assert.equal(
          (await as(coordinator, (tx) => tx`select app.can_review_submission(${id}) ok`))[0]!["ok"],
          false,
        );
        await owner.client`update app.operational_grants set revoked_at=now() where user_id=${peer} and capability='review_coordinator'`;
        await assert.rejects(
          as(
            peer,
            (tx) => tx`select app.coordinate_assignment(${id},1,${coordinator},${randomUUID()})`,
          ),
          { code: "42501" },
        );
      },
    );
    await t.test("confidential upload cannot claim and never becomes clean", async () => {
      const d = await stage(true);
      assert.equal(await claim(d.id), null);
      assert.equal((await owner.client`select app.document_is_clean(${d.id}) ok`)[0]!["ok"], false);
    });
    await t.test(
      "classification after claim blocks reservation before any transfer intent",
      async () => {
        const d = await stage(),
          c = await claim(d.id);
        assert.ok(c);
        await as(
          author,
          (tx) =>
            tx`select app.save_draft(${d.parent},1,'document','Synthetic proposal','General','A meaningful synthetic description for theological review.',array[]::text[],true)`,
        );
        await assert.rejects(reserve(d.id, c.lease), { code: "42501" });
        await release(d.id, c.lease);
      },
    );
    await t.test(
      "reservation fences classification throughout provider upload and after exclusion",
      async () => {
        const d = await stage(),
          c = await claim(d.id);
        assert.ok((await reserve(d.id, c.lease))[0]!["ok"]);
        await assert.rejects(
          as(
            author,
            (tx) =>
              tx`select app.save_draft(${d.parent},1,'document','Synthetic proposal','General','A meaningful synthetic description for theological review.',array[]::text[],true)`,
          ),
          { code: "23514" },
        );
        await as(author, (tx) => tx`select app.exclude_draft_document(${d.id},1)`);
        await assert.rejects(
          as(
            author,
            (tx) =>
              tx`select app.save_draft(${d.parent},2,'document','Synthetic proposal','General','A meaningful synthetic description for theological review.',array[]::text[],true)`,
          ),
          { code: "23514" },
        );
        await release(d.id, c.lease);
      },
    );
    await t.test(
      "concurrent classification waits for reservation commit and then fails closed",
      async () => {
        const d = await stage(),
          c = await claim(d.id);
        let editing: Promise<unknown> | undefined;
        await scanner.client.begin(async (tx) => {
          assert.ok(
            (await tx`select app.reserve_bouncer_scan(${d.id},${c.lease},0,500,${month}) ok`)[0]![
              "ok"
            ],
          );
          let observed!: () => void;
          const ready = new Promise<void>((resolve) => {
            observed = resolve;
          });
          let pid = 0;
          editing = as(author, async (rt) => {
            pid = Number((await rt`select pg_backend_pid() pid`)[0]!["pid"]);
            observed();
            return rt`select app.save_draft(${d.parent},1,'document','Synthetic proposal','General','A meaningful synthetic description for theological review.',array[]::text[],true)`;
          }).then(
            () => null,
            (error) => error,
          );
          await ready;
          let waiting = false;
          for (let attempt = 0; attempt < 50; attempt++) {
            waiting =
              (
                await scanner.client`select exists(select 1 from pg_locks where pid=${pid} and not granted) ok`
              )[0]!["ok"] === true;
            if (waiting) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          assert.equal(
            waiting,
            true,
            "classification update must wait behind the active reservation transaction",
          );
        });
        assert.equal(((await editing) as { code: string }).code, "23514");
        await release(d.id, c.lease);
      },
    );
    await t.test(
      "repeatable-read stale snapshots cannot bypass the reservation write fence",
      async () => {
        const d = await stage(),
          c = await claim(d.id);
        await assert.rejects(
          runtime.client.begin("isolation level repeatable read", async (tx) => {
            await tx`select set_config('cape.user_id',${author},true)`;
            await tx`select id from app.submissions where id=${d.parent}`;
            assert.ok((await reserve(d.id, c.lease))[0]!["ok"]);
            await tx`select app.save_draft(${d.parent},1,'document','Synthetic proposal','General','A meaningful synthetic description for theological review.',array[]::text[],true)`;
          }),
          { code: "40001" },
        );
        await release(d.id, c.lease);
      },
    );
    await t.test(
      "previous confidential provider IDs resume polling; missing-ID submission markers are held, never reserved again",
      async () => {
        const d = await stage(true),
          scanId = "scan_" + randomUUID();
        await owner.client`update app.document_scans set provider='bouncer',external_scan_id=${scanId},provider_status='pending',submitted_at=now(),submission_revision=1 where document_id=${d.id}`;
        const c = await claim(d.id);
        assert.equal(c.externalScanId, scanId);
        assert.equal((await reserve(d.id, c.lease))[0]!["ok"], false);
        await scanner.client`select app.finish_bouncer_scan(${d.id},${c.lease},${scanId},'failed',null,null,null,true)`;
        const ambiguous = await stage(true);
        await owner.client`update app.document_scans set provider='bouncer',provider_status='submitting',submitted_at=now(),submission_revision=1 where document_id=${ambiguous.id}`;
        const a = await claim(ambiguous.id);
        assert.ok(a);
        assert.equal((await reserve(ambiguous.id, a.lease))[0]!["ok"], false);
        await scanner.client`select app.finish_bouncer_scan(${ambiguous.id},${a.lease},null,'ambiguous',null,null,null,false)`;
        assert.equal(await claim(ambiguous.id), null);
        assert.equal(
          (
            await owner.client`select provider_status from app.document_scans where document_id=${ambiguous.id}`
          )[0]!["provider_status"],
          "ambiguous",
        );
      },
    );
    await t.test(
      "historical confidential provider verdicts remain evidence and cannot authorize bytes",
      async () => {
        const d = await stage(true),
          id = "scan_" + randomUUID();
        legacyConfidential = d.id;
        await owner.client`update app.document_scans set provider='bouncer',external_scan_id=${id},provider_status='pending',submitted_at=now(),submission_revision=1 where document_id=${d.id}`;
        const c = await claim(d.id);
        assert.equal(
          (
            await scanner.client`select app.finish_bouncer_scan(${d.id},${c.lease},${id},'clean',${"a".repeat(64)},${"a".repeat(64)},100,true) ok`
          )[0]!["ok"],
          true,
        );
        assert.equal(
          (await owner.client`select state from app.document_scans where document_id=${d.id}`)[0]![
            "state"
          ],
          "clean",
          "provider evidence is preserved",
        );
        assert.equal(
          (await as(author, (tx) => tx`select app.document_is_clean(${d.id}) ok`))[0]!["ok"],
          false,
        );
        await assert.rejects(
          as(
            author,
            (tx) => tx`select app.record_document_access(${d.id},'authorized',${randomUUID()})`,
          ),
          { code: "42501" },
        );
      },
    );
    await t.test(
      "authenticated HTTP enforces operational/hard limits, confidentiality and duplicate IDs before unnecessary upload reservations",
      async () => {
        const origin = "http://localhost:3220",
          password = "Synthetic phase431 credential passphrase";
        const auth = createAuthService(
          runtime,
          new EmailService(new TestEmailProvider(), {
            origin,
            from: "Capture <capture@example.invalid>",
          }),
          { secret: "Synthetic-phase431-secret-at-least-32-characters", baseURL: origin },
        );
        await owner.client`insert into auth.accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) values(${randomUUID()},${author},'credential',${author},${await hashPassword(password)},now(),now())`;
        const login = await auth.handle(
          new Request(origin + "/api/auth/sign-in/email", {
            method: "POST",
            headers: { origin, "content-type": "application/json" },
            body: JSON.stringify({ email: author + "@example.invalid", password }),
          }),
        );
        assert.equal(login.status, 200);
        const oversizedAuth = new Request(origin + "/api/auth/sign-in/email", {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: "x".repeat(16385),
        });
        assert.equal(oversizedAuth.headers.get("content-length"), null);
        assert.equal((await auth.handle(oversizedAuth)).status, 413);
        assert.equal(
          (
            await auth.handle(
              new Request(origin + "/api/auth/sign-in/email", {
                method: "POST",
                headers: { origin, "content-type": "text/plain" },
                body: "{}",
              }),
            )
          ).status,
          415,
        );

        const [sessionPolicy] =
          await owner.client`select max(extract(epoch from (expires_at-(now() at time zone 'UTC'))))::float seconds from auth.sessions where user_id=${author}`;
        assert.ok(
          Number(sessionPolicy!["seconds"]) > 28700 && Number(sessionPolicy!["seconds"]) <= 28801,
        );
        assert.ok(
          login.headers
            .getSetCookie()
            .every((value) => value.includes("HttpOnly") && /SameSite=Lax/i.test(value)),
        );

        const cookie = login.headers
            .getSetCookie()
            .map((v) => v.split(";")[0])
            .join("; "),
          manifest = await readDisposableManifest();
        const storage = new LocalPrivateStorageProvider(manifest.root + "/http-storage");
        const service = createDocumentService(auth, storage, origin);
        assert.equal(
          (
            await service.handle(
              new Request(origin + "/api/documents/" + legacyConfidential + "/download", {
                headers: { cookie },
              }),
              legacyConfidential,
            )
          ).status,
          404,
        );
        const parent = await draft(author, false, "document"),
          confidential = await draft(author, true, "document");
        const pdf = (size: number) => {
          const body = Buffer.alloc(size, 32);
          body.write("%PDF-1.4\n");
          body.write("\n%%EOF\n", size - 7);
          return body;
        };
        const upload = (
          size: number,
          id = parent,
          key = randomUUID(),
          declared = true,
          endpoint = service,
        ) =>
          endpoint.handle(
            new Request(origin + `/api/documents?submissionId=${id}&requestId=${key}`, {
              method: "POST",
              headers: {
                origin,
                cookie,
                "content-type": "application/pdf",
                "x-document-name": "synthetic.pdf",
                ...(declared ? { "content-length": String(size) } : {}),
              },
              body: pdf(declared && size > 4194304 ? 100 : size),
            }),
          );
        for (const size of [4194303, 4194304]) assert.equal((await upload(size)).status, 201);
        const [before] = await owner.client`select count(*)::int n from app.documents`;
        for (const size of [4194305, MAX_PDF_BYTES]) {
          const result = await upload(size);
          assert.equal(result.status, 409);
          assert.equal((await result.json()).code, "screening_unavailable");
        }
        assert.equal((await upload(MAX_PDF_BYTES + 1)).status, 413);
        assert.equal((await upload(100, confidential)).status, 409);
        assert.equal(
          (await owner.client`select count(*)::int n from app.documents`)[0]!["n"],
          before!["n"],
        );
        assert.equal(
          (await upload(4194305, parent, randomUUID(), false)).status,
          409,
          "streamed bytes enforce operational limit without Content-Length",
        );
        const key = randomUUID();
        assert.equal((await upload(100, parent, key)).status, 201);
        assert.equal((await upload(100, parent, key)).status, 409);
        // Trusted server policy can accept exactly 20 MiB; the immutable safety ceiling remains enforced.
        const large = createDocumentService(auth, storage, origin, MAX_PDF_BYTES, {
          hardMaxBytes: MAX_PDF_BYTES,
          screeningMaxBytes: MAX_PDF_BYTES,
          confidentialPdfAllowed: false,
        });
        assert.equal((await upload(MAX_PDF_BYTES, parent, randomUUID(), false, large)).status, 201);
        assert.equal(
          (await upload(MAX_PDF_BYTES + 1, parent, randomUUID(), false, large)).status,
          413,
        );
        assert.equal((await upload(100, confidential, randomUUID(), true, large)).status, 409);
      },
    );
  } finally {
    await Promise.all([owner.close(), runtime.close(), scanner.close()]);
  }
});
