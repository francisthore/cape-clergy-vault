import { scanTestDocument, cleanTestScanRows } from "./test-scanning.ts";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { hashPassword } from "better-auth/crypto";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";
import { createAuthService } from "../src/lib/auth/service.server.ts";
import { createDocumentService } from "../src/lib/documents/service.server.ts";
import { LocalPrivateStorageProvider } from "../src/lib/documents/storage.server.ts";
import type { StorageProvider } from "../src/lib/documents/storage.server.ts";
import { EmailService, TestEmailProvider } from "../src/lib/email/service.server.ts";

const http = process.argv.includes("--http");
test(`Phase 3C: ${http ? "built Node HTTP" : "restricted runtime"} documents`, async (t) => {
  const owner = await connectLocalDatabase(),
    runtime = await connectLocalRuntime();
  const root = await mkdtemp(join(tmpdir(), "cape-documents-"));
  const prefix = `phase3c-${randomUUID()}`;
  const users = [
    "owner",
    "other",
    "reviewer",
    "approver",
    "pending",
    "rejected",
    "suspended",
    "unverified",
    "noConsent",
  ].map((key) => ({ key, id: `${prefix}-${key.toLowerCase()}` }));
  const ids = users.map((u) => u.id);
  const user = (key: string) => users.find((u) => u.key === key)!.id;
  const baseURL = http ? "http://localhost:3213" : "http://localhost:3000";
  const secret = randomBytes(32).toString("hex"),
    password = "Phase 3C disposable fixture passphrase";
  const email = new EmailService(new TestEmailProvider(), {
    origin: baseURL,
    from: "Local <local@example.invalid>",
  });
  const auth = createAuthService(runtime, email, { secret, baseURL });
  const storage = new LocalPrivateStorageProvider(root);
  const service = createDocumentService(auth, storage, baseURL);
  const cookies = new Map<string, string>();
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
  const submission = randomUUID(),
    shared = randomUUID(),
    confidential = randomUUID(),
    reviewed = randomUUID();
  const submissions = [submission, shared, confidential, reviewed];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (http && new URL(url).origin === baseURL) return originalFetch(input, init);
    throw new Error("External network forbidden in document tests");
  };
  let child: ReturnType<typeof spawn> | undefined;
  const send = async (request: Request, documentId?: string, target = service) =>
    http ? fetch(request) : target.handle(request, documentId);
  const upload = async (
    key = "owner",
    body: Uint8Array = pdf,
    requestId = randomUUID(),
    sub = submission,
    extra: Record<string, string> = {},
    target = service,
  ) => {
    const response = await send(
      new Request(`${baseURL}/api/documents?submissionId=${sub}&requestId=${requestId}`, {
        method: "POST",
        headers: {
          cookie: cookies.get(key) ?? "",
          origin: baseURL,
          "content-type": "application/pdf",
          "x-document-name": "fixture.pdf",
          ...extra,
        },
        body: new Uint8Array(body),
      }),
      undefined,
      target,
    );
    if (response.status === 201 && sub !== submission)
      await scanTestDocument((await response.clone().json()).id, storage);
    return response;
  };
  const download = (id: string, key = "owner", target = service, signal?: AbortSignal) =>
    send(
      new Request(`${baseURL}/api/documents/${id}/download`, {
        headers: { cookie: cookies.get(key) ?? "" },
        ...(signal ? { signal } : {}),
      }),
      id,
      target,
    );
  const auditRows = (id: string) =>
    owner.client`select action,outcome,correlation_id from app.audit_events where document_id=${id} order by id`;
  let doc = "",
    objectKey = "";
  try {
    if (http) {
      const guard = join(root, "network-guard.mjs");
      await writeFile(
        guard,
        "const original = globalThis.fetch; globalThis.fetch = (input, init) => { const u = new URL(input instanceof Request ? input.url : String(input)); if (!['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error('External network forbidden in smoke test'); return original(input, init); };",
        { mode: 0o600 },
      );
      child = spawn(process.execPath, ["--import", guard, ".output/server/index.mjs"], {
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: "3213",
          NODE_ENV: "production",
          BETTER_AUTH_URL: baseURL,
          BETTER_AUTH_SECRET: secret,
          CAPE_STORAGE_ROOT: root,
          CAPE_MAX_UPLOAD_BYTES: String(20 * 1024 * 1024),
          CAPE_DOCUMENT_TYPES: "pdf",
          CAPE_STORAGE_PROVIDER: "local",
          EMAIL_PROVIDER: "development",
          CAPE_LOCAL_EMAIL_CAPTURE: "true",
          RESEND_API_KEY: "",
          EMAIL_FROM: "Local <local@example.invalid>",
          EMAIL_REPLY_TO: "",
          SUPABASE_URL: "",
          SUPABASE_PUBLISHABLE_KEY: "",
        },
        stdio: ["ignore", "ignore", "pipe"],
      });
      child.stderr?.on("data", () => {
        /* Do not log environment, SQL or request data. */
      });
      let ready = false;
      for (let n = 0; n < 60; n++) {
        assert.equal(child.exitCode, null);
        try {
          if ((await fetch(baseURL + "/auth")).status === 200) {
            ready = true;
            break;
          }
        } catch {
          /* Startup. */
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      assert.ok(ready, "built Node starts");
    }
    const hash = await hashPassword(password);
    for (const { key, id } of users) {
      await owner.client`insert into auth.users(id,name,email,email_verified) values(${id},'Document fixture',${id + "@example.invalid"},true)`;
      await owner.client`insert into auth.accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) values(${randomUUID()},${id},'credential',${id},${hash},now(),now())`;
      await owner.client`insert into app.clergy_profiles(user_id,full_name,approval_status) values(${id},'Document fixture',${["pending", "rejected"].includes(key) ? key : "approved"})`;
      await owner.client`insert into app.role_assignments(user_id,role) values(${id},'clergy')`;
      if (key !== "noConsent")
        await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${id},'repository-v1','repository','accepted')`;
      const req = new Request(baseURL + "/api/auth/sign-in/email", {
        method: "POST",
        headers: { origin: baseURL, "content-type": "application/json" },
        body: JSON.stringify({ email: id + "@example.invalid", password }),
      });
      const login = http ? await fetch(req) : await auth.handle(req);
      assert.equal(login.status, 200, key);
      cookies.set(
        key,
        login.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; "),
      );
    }
    // Exercise current-state checks using sessions issued while the fixtures were eligible.
    await owner.client`update auth.users set email_verified=false where id=${user("unverified")}`;
    await owner.client`update app.clergy_profiles set approval_status='suspended' where user_id=${user("suspended")}`;
    await owner.client`insert into app.role_assignments(user_id,role) values(${user("reviewer")},'reviewer'),(${user("approver")},'approver')`;
    await owner.client`insert into app.submissions(id,owner_id,title,status,confidential) values
      (${submission},${user("owner")},'Private document fixture','draft',false),
      (${shared},${user("owner")},'Shared fixture','draft',false),
      (${confidential},${user("owner")},'Confidential fixture','draft',true),
      (${reviewed},${user("owner")},'Review fixture','under_review',false)`;
    await t.test("anonymous and inactive/unverified/unconsented uploads are rejected", async () => {
      for (const key of [
        "anonymous",
        "pending",
        "rejected",
        "suspended",
        "unverified",
        "noConsent",
      ])
        assert.equal((await upload(key)).status, 403, key);
      assert.equal((await upload("other")).status, 403);
      assert.equal((await upload("reviewer")).status, 403);
      assert.equal((await upload("owner", pdf, randomUUID(), reviewed)).status, 403);
      assert.equal(
        (await upload("owner", pdf, randomUUID(), submission, { origin: "https://evil.invalid" }))
          .status,
        403,
      );
    });
    await t.test("valid upload persists private bytes and complete accurate metadata", async () => {
      const response = await upload();
      assert.equal(response.status, 201, await response.clone().text());
      doc = (await response.json()).id;
      const [row] = await owner.client`select * from app.documents where id=${doc}`;
      assert.equal(row!["state"], "quarantined");
      await scanTestDocument(doc, storage);
      assert.equal(Number(row!["byte_size"]), pdf.length);
      assert.equal(row!["sha256"], createHash("sha256").update(pdf).digest("hex"));
      objectKey = String(row!["storage_key"]);
      assert.notEqual(objectKey, doc);
      const list = await send(
        new Request(`${baseURL}/api/documents?submissionId=${submission}`, {
          headers: { cookie: cookies.get("owner")! },
        }),
      );
      assert.equal(list.status, 200);
      const data = await list.json();
      assert.equal(data.documents[0].id, doc);
      assert.ok(!JSON.stringify(data).includes("storage_key"));
      assert.ok(!JSON.stringify(data).includes(objectKey));
      assert.ok(!JSON.stringify(data).includes(root));
      assert.equal(
        (
          await send(
            new Request(`${baseURL}/api/documents?submissionId=${submission}`, {
              headers: { cookie: cookies.get("other")! },
            }),
          )
        ).status,
        404,
      );
    });
    await t.test(
      "invalid/empty/mismatched/oversized files and forged metadata fail safely",
      async () => {
        for (const body of [
          Buffer.alloc(0),
          Buffer.from("MZ fake executable"),
          Buffer.from("%PDF-1.7\ntruncated"),
        ])
          assert.ok([400, 415].includes((await upload("owner", body)).status));
        assert.equal((await upload("owner", Buffer.alloc(20 * 1024 * 1024 + 1))).status, 413);
        assert.equal(
          (
            await upload("owner", pdf, randomUUID(), submission, {
              "x-document-name": "..%2Fsecret.pdf",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await upload("owner", pdf, randomUUID(), submission, {
              "content-type": "application/zip",
            })
          ).status,
          415,
        );
        const forged = new Request(
          `${baseURL}/api/documents?submissionId=${submission}&requestId=${randomUUID()}&storageKey=forged&role=reviewer`,
          {
            method: "POST",
            headers: {
              origin: baseURL,
              cookie: cookies.get("owner")!,
              "x-document-name": "a.pdf",
              "content-type": "application/pdf",
            },
            body: pdf,
          },
        );
        assert.equal((await send(forged)).status, 400);
        assert.equal((await download("not-a-uuid")).status, 400);
        assert.ok(!(await readdir(root)).some((n) => n.endsWith(".part")));
      },
    );
    await t.test(
      "duplicates and concurrency never overwrite or create duplicate request records",
      async () => {
        const key = randomUUID();
        const responses = await Promise.all([upload("owner", pdf, key), upload("owner", pdf, key)]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
        const parallel = await Promise.all([upload(), upload()]);
        assert.deepEqual(
          parallel.map((r) => r.status),
          [201, 201],
        );
        assert.equal(
          (await owner.client`select id from app.documents where upload_request_id=${key}`).length,
          1,
        );
      },
    );
    await t.test(
      "downloads enforce all live account states and RLS; approver is not reviewer",
      async () => {
        for (const key of [
          "anonymous",
          "pending",
          "rejected",
          "suspended",
          "unverified",
          "noConsent",
        ])
          assert.equal((await download(doc, key)).status, 403, key);
        for (const key of ["other", "approver", "reviewer"])
          assert.equal((await download(doc, key)).status, 404);
        for (const key of ["owner"]) {
          const response = await download(doc, key);
          assert.equal(response.status, 200);
          assert.equal(response.headers.get("cache-control"), "private, no-store");
          assert.equal(response.headers.get("x-content-type-options"), "nosniff");
          assert.match(response.headers.get("content-disposition")!, /^attachment;/);
          assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
        }
        const events = await auditRows(doc);
        assert.ok(events.some((r) => r["action"] === "document.download.denied"));
        const starts = events.filter((r) => r["action"] === "document.download.started");
        assert.equal(starts.length, 1);
        for (const start of starts)
          assert.ok(
            events.some(
              (r) =>
                r["action"] === "document.download.authorized" &&
                r["correlation_id"] === start["correlation_id"],
            ),
          );
      },
    );
    await t.test(
      "accepted sharing preserves confidentiality and live reviewer revocation",
      async () => {
        const sharedDoc = (await (await upload("owner", pdf, randomUUID(), shared)).json()).id;
        const privateDoc = (await (await upload("owner", pdf, randomUUID(), confidential)).json())
          .id;
        await owner.client`update app.submissions set status='accepted' where id=any(${[shared, confidential]})`;
        for (const key of ["other", "approver"]) {
          const response = await download(sharedDoc, key);
          assert.equal(response.status, 200);
          await response.arrayBuffer();
          assert.equal((await download(privateDoc, key)).status, 404);
        }
        assert.equal((await download(privateDoc, "reviewer")).status, 404);
        // Historical operator-only authorization fixture; the actual new invitation /
        // assignment / decision flow is exercised in phase3e.test.ts.
        await owner.client`insert into app.reviewer_assignments(submission_id,revision,reviewer_id,assigned_by) values(${confidential},1,${user("reviewer")},session_user)`;
        const reviewer = await download(privateDoc, "reviewer");
        assert.equal(reviewer.status, 200);
        await reviewer.arrayBuffer();
        await owner.client`update app.role_assignments set revoked_at=now() where user_id=${user("reviewer")} and role='reviewer'`;
        assert.equal((await download(privateDoc, "reviewer")).status, 404);
        assert.equal((await upload("owner", pdf, randomUUID(), shared)).status, 403);
        await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${user("other")},'repository-v1','repository','withdrawn')`;
        assert.equal((await download(sharedDoc, "other")).status, 403);
      },
    );
    await t.test(
      "missing rows and missing storage objects have safe errors and accurate audit events",
      async () => {
        const missing = randomUUID();
        assert.equal((await download(missing)).status, 404);
        assert.ok(
          (await auditRows(missing)).some((r) => r["action"] === "document.download.unavailable"),
        );
        const response = await upload();
        const missingObject = (await response.json()).id;
        await scanTestDocument(missingObject, storage);
        const [metadata] =
          await owner.client`select storage_key from app.documents where id=${missingObject}`;
        await storage.delete(String(metadata!["storage_key"]));
        const result = await download(missingObject);
        assert.equal(result.status, 404);
        assert.ok(!(await result.text()).includes(root));
        assert.ok(
          (await auditRows(missingObject)).some(
            (r) => r["action"] === "document.download.open_failed",
          ),
        );
      },
    );
    await t.test(
      "restricted role cannot finalize forged records, mutate audit or promote inaccessible uploads",
      async () => {
        await assert.rejects(
          runtime.client`update app.documents set state='available' where id=${doc}`,
        );
        await assert.rejects(runtime.client`delete from app.audit_events`);
        await assert.rejects(runtime.client`truncate app.audit_events`);
        await assert.rejects(
          owner.client`update app.audit_events set action='forged' where document_id=${doc}`,
        );
        await assert.rejects(
          runtime.client.begin(async (tx) => {
            await tx`select set_config('cape.user_id',${user("other")},true)`;
            await tx`select app.finalize_document(${doc},12,${"0".repeat(64)})`;
          }),
        );
      },
    );
    if (!http) {
      await t.test("audit outage prevents file opening and protected transfer", async () => {
        let opens = 0;
        const broken = createDocumentService(
          {
            ...auth,
            withAuditDatabase: async () => {
              throw new Error("simulated audit outage");
            },
          },
          {
            save: storage.save.bind(storage),
            delete: storage.delete.bind(storage),
            open: async (key) => {
              opens++;
              return storage.open(key);
            },
          },
          baseURL,
        );
        assert.equal((await download(doc, "owner", broken)).status, 503);
        assert.equal(opens, 0);
      });
      await t.test(
        "second required audit failure closes the object before any bytes are read",
        async () => {
          let audits = 0,
            reads = 0,
            closes = 0;
          const failing = createDocumentService(
            {
              ...auth,
              async withAuditDatabase(headers, work) {
                if (++audits === 2) throw new Error("simulated audit failure after file open");
                return auth.withAuditDatabase(headers, work);
              },
            },
            {
              save: storage.save.bind(storage),
              delete: storage.delete.bind(storage),
              async open(key) {
                const object = await storage.open(key);
                return {
                  byteSize: object.byteSize,
                  async read() {
                    reads++;
                    return object.read();
                  },
                  async close() {
                    closes++;
                    await object.close();
                  },
                };
              },
            },
            baseURL,
          );
          assert.equal((await download(doc, "owner", failing)).status, 503);
          assert.equal(reads, 0);
          assert.equal(closes, 1);
        },
      );
      await t.test("interrupted uploads fail the row and clean all partial files", async () => {
        const requestId = randomUUID(),
          abort = new AbortController();
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(pdf.subarray(0, 12));
          },
        });
        const pending = service.handle(
          new Request(
            `${baseURL}/api/documents?submissionId=${submission}&requestId=${requestId}`,
            {
              method: "POST",
              headers: {
                origin: baseURL,
                cookie: cookies.get("owner")!,
                "content-type": "application/pdf",
                "x-document-name": "partial.pdf",
              },
              body,
              signal: abort.signal,
              duplex: "half",
            } as RequestInit,
          ),
        );
        // Wait for the actual pending reservation before simulating a disconnected client.
        for (let n = 0; n < 100; n++) {
          const rows =
            await owner.client`select id from app.documents where upload_request_id=${requestId}`;
          if (rows.length) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        abort.abort();
        assert.equal((await pending).status, 408);
        const [row] =
          await owner.client`select state from app.documents where upload_request_id=${requestId}`;
        assert.equal(row!["state"], "failed");
        assert.ok(!(await readdir(root)).some((n) => n.endsWith(".part")));
      });
      await t.test(
        "unknown finalization outcomes retain known private pending objects for recovery",
        async () => {
          let calls = 0;
          const broken = createDocumentService(
            {
              ...auth,
              async withApprovedDatabase(headers, work) {
                if (++calls === 3) throw new Error("simulated metadata database outage");
                return auth.withApprovedDatabase(headers, work);
              },
              withAuditDatabase: async () => {
                throw new Error("simulated recovery database outage");
              },
            },
            storage,
            baseURL,
          );
          const requestId = randomUUID();
          assert.equal((await upload("owner", pdf, requestId, submission, {}, broken)).status, 503);
          const [row] =
            await owner.client`select id,state,storage_key from app.documents where upload_request_id=${requestId}`;
          assert.equal(row!["state"], "pending");
          assert.equal((await download(String(row!["id"]))).status, 404);
          const object = await storage.open(String(row!["storage_key"]));
          await object.close();
          // Explicit known-fixture recovery, not a general orphan deletion routine.
          await runtime.client.begin(async (tx) => {
            await tx`select set_config('cape.user_id',${user("owner")},true)`;
            await tx`select app.fail_document(${row!["id"]})`;
          });
          await storage.delete(String(row!["storage_key"]));
        },
      );
      await t.test(
        "filesystem write failure creates only failed metadata and no object",
        async () => {
          const broken = createDocumentService(
            auth,
            {
              ...storage,
              save: async () => {
                throw new Error("simulated disk full");
              },
              open: storage.open.bind(storage),
              delete: storage.delete.bind(storage),
            },
            baseURL,
          );
          const key = randomUUID();
          assert.equal((await upload("owner", pdf, key, submission, {}, broken)).status, 503);
          const [row] =
            await owner.client`select state,storage_key from app.documents where upload_request_id=${key}`;
          assert.equal(row!["state"], "failed");
          await assert.rejects(storage.open(String(row!["storage_key"])));
        },
      );
      await t.test(
        "consent changes during upload prevent finalization and remove the known failed object",
        async () => {
          const provider: StorageProvider = {
            open: storage.open.bind(storage),
            delete: storage.delete.bind(storage),
            async save(key, body, signal) {
              const object = await storage.save(key, body, signal);
              await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${user("owner")},'repository-v1','repository','withdrawn')`;
              return object;
            },
          };
          const key = randomUUID();
          const service = createDocumentService(auth, provider, baseURL);
          assert.equal((await upload("owner", pdf, key, submission, {}, service)).status, 403);
          const [row] =
            await owner.client`select state,storage_key from app.documents where upload_request_id=${key}`;
          assert.equal(row!["state"], "failed");
          await assert.rejects(storage.open(String(row!["storage_key"])));
          await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${user("owner")},'repository-v1','repository','accepted')`;
        },
      );
      await t.test(
        "ambiguous successful commit retains quarantined bytes for reconciliation",
        async () => {
          let calls = 0;
          const ambiguous = createDocumentService(
            {
              ...auth,
              async withApprovedDatabase(headers, work) {
                const result = await auth.withApprovedDatabase(headers, work);
                if (++calls === 3) throw new Error("simulated lost commit acknowledgement");
                return result;
              },
            },
            storage,
            baseURL,
          );
          const key = randomUUID();
          assert.equal((await upload("owner", pdf, key, submission, {}, ambiguous)).status, 503);
          const [row] =
            await owner.client`select id,state,storage_key from app.documents where upload_request_id=${key}`;
          assert.equal(row!["state"], "quarantined");
          const object = await storage.open(String(row!["storage_key"]));
          await object.close();
        },
      );
      await t.test(
        "stream failures and cancellation close handles and never claim receipt",
        async () => {
          let reads = 0,
            closes = 0;
          const provider: StorageProvider = {
            save: storage.save.bind(storage),
            delete: storage.delete.bind(storage),
            async open() {
              return {
                byteSize: pdf.length,
                async read() {
                  reads++;
                  if (reads === 1) return pdf.subarray(0, 8);
                  throw new Error("simulated read failure");
                },
                async close() {
                  closes++;
                },
              };
            },
          };
          const failing = createDocumentService(auth, provider, baseURL);
          const response = await download(doc, "owner", failing);
          assert.equal(response.status, 200);
          assert.equal(reads, 0);
          await assert.rejects(response.arrayBuffer());
          assert.equal(reads, 2);
          assert.equal(closes, 1);
          const rows = await auditRows(doc);
          const correlation = response.headers.get("x-request-id");
          assert.ok(
            rows.some(
              (r) =>
                r["correlation_id"] === correlation &&
                r["action"] === "document.download.transfer_failed",
            ),
          );
          assert.ok(
            !rows.some(
              (r) =>
                r["correlation_id"] === correlation &&
                r["action"] === "document.download.stream_ended",
            ),
          );
          const aborted = await download(doc);
          await aborted.body!.cancel();
          assert.ok(
            (await auditRows(doc)).some(
              (r) =>
                r["correlation_id"] === aborted.headers.get("x-request-id") &&
                r["action"] === "document.download.cancelled",
            ),
          );
          const abort = new AbortController();
          const active = await download(doc, "owner", service, abort.signal);
          abort.abort();
          await assert.rejects(active.arrayBuffer());
          let cancellationRecorded = false;
          for (let n = 0; n < 100; n++) {
            const events = await auditRows(doc);
            if (
              events.some(
                (r) =>
                  r["correlation_id"] === active.headers.get("x-request-id") &&
                  r["action"] === "document.download.cancelled",
              )
            ) {
              cancellationRecorded = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          assert.ok(cancellationRecorded, "abort terminal audit committed before fixture teardown");
        },
      );
    }
    await t.test(
      "multi-megabyte downloads preserve bytes through bounded filesystem reads",
      async () => {
        const large = Buffer.concat([
          Buffer.from("%PDF-1.7\n"),
          Buffer.alloc(2 * 1024 * 1024, 32),
          Buffer.from("\n%%EOF\n"),
        ]);
        const created = await upload("owner", large);
        assert.equal(created.status, 201);
        const id = (await created.json()).id;
        await scanTestDocument(id, storage);
        const response = await download(id);
        assert.equal(response.status, 200);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), large);
        const [row] = await owner.client`select storage_key from app.documents where id=${id}`;
        const object = await storage.open(String(row!["storage_key"]));
        try {
          assert.equal((await object.read())!.byteLength, 64 * 1024);
        } finally {
          await object.close();
        }
      },
    );
    if (http)
      await t.test("public paths and legacy routes cannot return private bytes", async () => {
        for (const path of [
          `/.local/storage/${objectKey}.blob`,
          `/storage/${objectKey}.blob`,
          `/submissions/${doc}`,
          `/api/documents/${doc}`,
        ]) {
          const response = await fetch(baseURL + path, { redirect: "manual" });
          assert.ok(!(await response.text()).includes(pdf.toString()));
        }
        const page = await fetch(baseURL + "/documents");
        assert.equal(page.status, 200);
        assert.match(await page.text(), /Submission documents/);
        const legacy = await fetch(baseURL + "/dashboard", {
          redirect: "manual",
          headers: { cookie: cookies.get("owner")! },
        });
        assert.ok([302, 307].includes(legacy.status));
      });
  } finally {
    globalThis.fetch = originalFetch;
    if (child) {
      child.kill("SIGTERM");
      if (child.exitCode === null) await once(child, "exit");
    }
    // Drain request/terminal-audit work before removing committed fixture identities.
    await runtime.close();
    await owner.client.begin(async (tx) => {
      for (const table of ["audit_events", "popia_consent_events"])
        await tx.unsafe(`alter table app.${table} disable trigger user`);
      await tx`delete from app.audit_events where actor_id=any(${ids}) or submission_id=any(${submissions}) or document_id in (select id from app.documents where submission_id=any(${submissions}))`;
      await tx`delete from app.popia_consent_events where user_id=any(${ids})`;
      await cleanTestScanRows(tx, submissions);
      await tx`delete from app.documents where submission_id=any(${submissions})`;
      await tx`delete from app.reviewer_assignments where submission_id=any(${submissions})`;
      await tx`delete from app.submissions where id=any(${submissions})`;
      await tx`delete from app.approval_notifications where user_id=any(${ids})`;
      await tx`delete from app.role_assignments where user_id=any(${ids})`;
      await tx`delete from app.clergy_profiles where user_id=any(${ids})`;
      await tx`delete from auth.users where id=any(${ids})`;
      for (const table of ["audit_events", "popia_consent_events"])
        await tx.unsafe(`alter table app.${table} enable trigger user`);
    });
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});
