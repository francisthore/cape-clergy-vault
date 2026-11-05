import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { hashPassword } from "better-auth/crypto";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";
import { createAuthService } from "../src/lib/auth/service.server.ts";
import { createApprovalService } from "../src/lib/approvals/service.server.ts";
import { createSubmissionService } from "../src/lib/submissions/service.server.ts";
import { createDocumentService } from "../src/lib/documents/service.server.ts";
import { LocalPrivateStorageProvider } from "../src/lib/documents/storage.server.ts";
import { createReviewService } from "../src/lib/reviews/service.server.ts";
import { createInvitationProof, openInvitationProof } from "../src/lib/reviews/tokens.server.ts";
import { deliverReviewerNotifications } from "../src/lib/reviews/notifications.server.ts";
import { EmailService, TestEmailProvider } from "../src/lib/email/service.server.ts";
import { resolveEmailSettings } from "../src/lib/settings/email.server.ts";
const http = process.argv.includes("--http");
test(`Phase 3E ${http ? "built Node HTTP" : "restricted runtime"} reviewer workflow`, async (t) => {
  const owner = await connectLocalDatabase(),
    runtime = await connectLocalRuntime(),
    root = await mkdtemp(join(tmpdir(), "cape-phase3e-"));
  const prefix = `phase3e-${randomUUID()}`,
    origin = http ? "http://localhost:3215" : "http://localhost:3000",
    secret = randomBytes(32).toString("hex"),
    password = "Disposable Phase 3E test passphrase";
  const ids: string[] = [],
    identities = new Map<string, string>(),
    cookies = new Map<string, string>();
  const identity = (name: string) => identities.get(name)!;
  const provider = new TestEmailProvider();
  const email = new EmailService(
    provider,
    { origin, from: "Local <local@example.invalid>" },
    async () => {
      const s = await resolveEmailSettings(runtime.client);
      return {
        from: `${s.displayName} <${s.fromEmail}>`,
        replyTo: s.replyTo,
        transactionalEnabled: s.transactionalEnabled,
        notificationsEnabled: s.notificationsEnabled,
      };
    },
  );
  const auth = createAuthService(runtime, email, { baseURL: origin, secret }),
    approvals = createApprovalService(auth, origin),
    submissions = createSubmissionService(auth, origin),
    reviews = createReviewService(auth, origin),
    documents = createDocumentService(auth, new LocalPrivateStorageProvider(root), origin);
  const [initial] =
    await owner.client`select transactional_enabled,notifications_enabled from app.email_settings`;
  const originalFetch = globalThis.fetch;
  let child: ReturnType<typeof spawn> | undefined;
  globalThis.fetch = async (input, init) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    if (http && u.origin === origin) return originalFetch(input, init);
    throw Error("No external fetch in Phase 3E");
  };
  const as = async <T>(name: string, work: (tx: import("postgres").TransactionSql) => Promise<T>) =>
    runtime.client.begin(async (tx) => {
      await tx`select set_config('cape.user_id',${identity(name) ?? ""},true)`;
      return work(tx);
    });
  async function call(path: string, name = "", body?: unknown, extra: Record<string, string> = {}) {
    const request = new Request(origin + path, {
      redirect: "manual",
      headers: {
        origin,
        "Content-Type": "application/json",
        cookie: cookies.get(name) ?? "",
        ...extra,
      },
      ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    });
    if (http) return fetch(request);
    if (path.startsWith("/api/auth/")) return auth.handle(request);
    if (path.startsWith("/api/registrations")) return approvals.handle(request);
    if (path.startsWith("/api/reviewer")) return reviews.handle(request);
    if (path.startsWith("/api/documents/")) return documents.handle(request, path.split("/")[3]);
    return submissions.handle(request, path.startsWith("/api/repository"));
  }
  async function login(name: string) {
    const [u] = await owner.client`select email from auth.users where id=${identity(name)}`;
    const r = await call("/api/auth/sign-in/email", "", { email: u!["email"], password });
    assert.equal(r.status, 200, name);
    cookies.set(
      name,
      r.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    );
  }
  const address = (name: string) => `${prefix}-${name}@example.invalid`;
  async function seed(name: string, roles: string[] = []) {
    const id = `${prefix}-${name}`;
    ids.push(id);
    identities.set(name, id);
    await owner.client`insert into auth.users(id,name,email,email_verified) values(${id},'Disposable reviewer fixture',${address(name)},true)`;
    await owner.client`insert into auth.accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) values(${randomUUID()},${id},'credential',${id},${await hashPassword(password)},now(),now())`;
    await owner.client`insert into app.clergy_profiles(user_id,full_name,approval_status) values(${id},'Disposable reviewer fixture','approved')`;
    await owner.client`insert into app.role_assignments(user_id,role) values(${id},'clergy')`;
    for (const role of roles)
      await owner.client`insert into app.role_assignments(user_id,role) values(${id},${role})`;
    await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${id},'repository-v1','repository','accepted')`;
    await login(name);
  }
  async function register(name: string) {
    assert.equal(
      (
        await call("/api/auth/register", "", {
          email: address(name),
          password,
          confirmPassword: password,
          title: "Rev.",
          fullName: "Disposable " + name,
          parish: "Test parish",
          phone: "",
          acknowledged: true,
          noticeVersion: "repository-v1",
        })
      ).status,
      200,
    );
    const [u] = await owner.client`select id from auth.users where email=${address(name)}`;
    assert.ok(u);
    identities.set(name, String(u["id"]));
    ids.push(identity(name));
    let mail = provider.messages.find(
      (m) => m.to === address(name) && m.subject.startsWith("Verify"),
    );
    if (http) {
      for (const file of await readdir(".local/email")) {
        const m = JSON.parse(await readFile(".local/email/" + file, "utf8"));
        if (m.to === address(name) && m.subject.startsWith("Verify")) mail = m;
      }
    }
    assert.ok(mail);
    const url = mail.text.match(/https?:\/\/[^\s]+/)![0]!;
    const r = http ? await fetch(url, { redirect: "manual" }) : await auth.handle(new Request(url));
    assert.equal(r.status, 302);
    await login(name);
    assert.equal((await call("/api/reviewer", name)).status, 403);
    assert.equal(
      (
        await call("/api/registrations", "operator", {
          targetId: identity(name),
          action: "approve",
          reason: "Disposable end-to-end registration approval",
          requestId: randomUUID(),
        })
      ).status,
      200,
    );
  }
  const operator = async (
    action: string,
    name: string,
    subject: string | null = null,
    proof: ReturnType<typeof createInvitationProof> | null = null,
    confirmation?: string,
    expectedRevision?: number,
  ) => {
    const [s] =
      action === "assign"
        ? await owner.client`select revision from app.submissions where id=${subject}`
        : [];
    const revision =
      action === "assign" ? (expectedRevision ?? Number(s?.["revision"] ?? 0)) : null;
    return owner.client`select app.reviewer_operator(${action},${identity(name)},${subject},${proof?.digest ?? null},${proof?.sealed ?? null},${confirmation ?? `${action.toUpperCase()} ${identity(name)}${subject ? " " + subject : ""}${action === "assign" ? " REVISION " + revision : ""}`},${revision}) as id`;
  };
  async function issue(name: string) {
    const proof = createInvitationProof(secret, identity(name));
    const [row] = await operator("invite", name, null, proof);
    return { id: String(row!["id"]), proof };
  }
  async function deliverInvite(name: string, inv: string) {
    const [n] =
      await owner.client`select id from app.reviewer_notifications where invitation_id=${inv}`;
    assert.equal(
      await deliverReviewerNotifications(owner, email, origin, secret, 1, String(n!["id"])),
      1,
    );
    const mail = provider.messages.at(-1)!;
    assert.ok(mail.to === address(name));
    const token = new URLSearchParams(
      new URL(mail.text.match(/https?:\/\/[^\s]+/)![0]!).hash.slice(1),
    ).get("token")!;
    assert.ok(token.length === 43);
    return token;
  }
  const accept = (name: string, token: string) =>
    call("/api/reviewer", name, { action: "accept-invitation", token });
  async function onboard(name: string) {
    const inv = await issue(name),
      token = await deliverInvite(name, inv.id);
    assert.equal((await accept(name, token)).status, 200);
    return inv;
  }
  async function draft(confidential = false, kind = "idea") {
    const r = await call("/api/submissions", "author", {
      action: "save",
      version: 0,
      kind,
      title: confidential ? "Hidden confidential resource" : "Disposable review resource",
      category: "General",
      abstract: "A meaningful theological description for this disposable resource.",
      keywords: ["phase3e"],
      confidential,
    });
    assert.equal(r.status, 200);
    return String((await r.json()).id);
  }
  async function submit(id: string, version = 1) {
    assert.equal(
      (await call("/api/submissions", "author", { action: "submit", id, version })).status,
      200,
    );
  }
  async function detail(id: string, name = "reviewer") {
    const r = await call("/api/reviewer?id=" + id, name);
    assert.equal(r.status, 200);
    return r.json();
  }
  function decision(
    id: string,
    version: number,
    outcome = "under_review",
    overrides: Record<string, unknown> = {},
  ) {
    return {
      action: "decide",
      id,
      version,
      outcome,
      feedback:
        outcome === "returned"
          ? "Please clarify the theological argument and add supporting references."
          : "",
      privateNotes:
        outcome === "accepted"
          ? "The revised argument satisfies the theological review criteria."
          : "Internal note that must remain private.",
      requestId: randomUUID(),
      ...overrides,
    };
  }
  let target = "",
    hidden = "",
    doc = "",
    assignment = "",
    proofToken = "";
  try {
    if (http) {
      const guard = join(root, "network-guard.mjs");
      await writeFile(
        guard,
        "globalThis.fetch=async()=>{throw Error('External fetch forbidden in HTTP smoke');};",
        { mode: 0o600 },
      );
      child = spawn(process.execPath, ["--import", guard, ".output/server/index.mjs"], {
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: "3215",
          NODE_ENV: "production",
          BETTER_AUTH_URL: origin,
          BETTER_AUTH_SECRET: secret,
          CAPE_STORAGE_ROOT: root,
          CAPE_STORAGE_PROVIDER: "local",
          CAPE_DOCUMENT_TYPES: "pdf",
          EMAIL_PROVIDER: "development",
          CAPE_LOCAL_EMAIL_CAPTURE: "true",
          RESEND_API_KEY: "",
        },
        stdio: ["ignore", "ignore", "pipe"],
      });
      child.stderr?.on("data", () => {
        /* No payload/error logging. */
      });
      let ready = false;
      for (let i = 0; i < 60; i++) {
        assert.equal(child.exitCode, null);
        try {
          if ((await fetch(origin + "/auth")).status === 200) {
            ready = true;
            break;
          }
        } catch {
          /*startup*/
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.ok(ready);
    }
    await owner.client`update app.email_settings set transactional_enabled=true,notifications_enabled=true`;
    // Explicit operator-only disposable authority fixture; the actual author/reviewer
    // below register, verify and are approved through the existing application flow.
    await seed("operator", ["approver"]);
    await t.test(
      "real registration, captured verification, clergy approval and no automatic reviewer grant",
      async () => {
        await register("author");
        await register("reviewer");
        assert.equal(
          (await as("reviewer", (tx) => tx`select app.is_reviewer() as allowed`))[0]!["allowed"],
          false,
        );
      },
    );
    await seed("other");
    await seed("reviewer2");
    await seed("admin", ["admin"]);
    await seed("settings");
    await owner.client`select app.authorize_settings_manager(${identity("settings")},${"GRANT SETTINGS MANAGER " + identity("settings")})`;
    await t.test("operator issuance is restricted, exact-ID confirmed and eligible", async () => {
      const proof = createInvitationProof(secret, identity("reviewer"));
      for (const name of ["author", "reviewer", "operator", "settings", "admin"])
        await assert.rejects(
          as(
            name,
            (tx) =>
              tx`select app.reviewer_operator('invite',${identity(name)},null,${proof.digest},${proof.sealed},${"INVITE " + identity(name)},null)`,
          ),
          { code: "42501" },
        );
      await assert.rejects(operator("invite", "reviewer", null, proof, "wrong"));
      await owner.client`update app.clergy_profiles set approval_status='pending' where user_id=${identity("other")}`;
      await assert.rejects(issue("other"));
      await owner.client`update app.clergy_profiles set approval_status='approved' where user_id=${identity("other")}`;
      await owner.client`update auth.users set email_verified=false where id=${identity("other")}`;
      await assert.rejects(issue("other"));
      await owner.client`update auth.users set email_verified=true where id=${identity("other")}`;
      const inv = await issue("reviewer");
      await assert.rejects(issue("reviewer"));
      const [stored] =
        await owner.client`select token_digest from app.reviewer_invitations where id=${inv.id}`;
      assert.ok(stored!["token_digest"] === inv.proof.digest);
      const [intent] =
        await owner.client`select * from app.reviewer_notifications where invitation_id=${inv.id}`;
      assert.ok(intent?.["sealed_token"]);
      assert.equal(
        (
          await call("/api/reviewer", "reviewer", {
            action: "invite",
            userId: identity("reviewer"),
          })
        ).status,
        400,
      );
      proofToken = await deliverInvite("reviewer", inv.id);
      assert.ok(!JSON.stringify(intent).includes(proofToken));
    });
    await t.test(
      "invitations bind mailbox and identity, require origin and explicit acceptance",
      async () => {
        assert.equal((await accept("other", proofToken)).status, 400);
        assert.equal(
          (
            await call(
              "/api/reviewer",
              "reviewer",
              { action: "accept-invitation", token: proofToken },
              { origin: "https://forged.invalid" },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call("/api/reviewer", "reviewer", {
              action: "accept-invitation",
              token: proofToken,
              role: "admin",
            })
          ).status,
          400,
        );
        const preview = await call("/api/reviewer", "reviewer", {
          action: "inspect-invitation",
          token: proofToken,
        });
        assert.equal(preview.status, 200);
        assert.ok(!(await preview.text()).includes(proofToken));
        assert.equal((await call("/api/reviewer", "reviewer")).status, 403);
        await owner.client.unsafe(
          "create function app.phase3e_accept_failure() returns trigger language plpgsql as $$ begin if NEW.action='invitation_accepted' then raise exception 'Injected failure'; end if; return NEW; end $$",
        );
        try {
          await owner.client`create trigger phase3e_accept_failure before insert on app.reviewer_events for each row execute function app.phase3e_accept_failure()`;
          assert.equal((await accept("reviewer", proofToken)).status, 503);
          assert.equal(
            (await as("reviewer", (tx) => tx`select app.is_reviewer() as allowed`))[0]!["allowed"],
            false,
          );
          const [inv] =
            await owner.client`select state from app.reviewer_invitations where user_id=${identity("reviewer")} and state='pending'`;
          assert.ok(inv);
        } finally {
          await owner.client`drop trigger phase3e_accept_failure on app.reviewer_events`;
          await owner.client`drop function app.phase3e_accept_failure()`;
        }
        const results = await Promise.all([
          accept("reviewer", proofToken),
          accept("reviewer", proofToken),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
        assert.equal((await accept("reviewer", proofToken)).status, 400);
        const [r] =
          await owner.client`select count(*)::int as count from app.role_assignments where user_id=${identity("reviewer")} and role='reviewer' and revoked_at is null`;
        assert.equal(r!["count"], 1);
        const [e] =
          await owner.client`select count(*)::int as count from app.reviewer_events where reviewer_id=${identity("reviewer")} and action='invitation_accepted'`;
        assert.equal(e!["count"], 1);
        for (const table of ["reviewer_events", "reviewer_invitations", "reviewer_notifications"])
          await assert.rejects(
            as("reviewer", (tx) => tx.unsafe(`select * from app.${table}`)),
            { code: "42501" },
          );
      },
    );
    await t.test("expiry, revocation and email changes invalidate invitation proof", async () => {
      for (const mode of ["expiry", "revoke", "email"]) {
        const inv = await issue("other"),
          token = openInvitationProof(inv.proof.sealed, secret, identity("other"));
        if (mode === "expiry")
          await owner.client`update app.reviewer_invitations set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=${inv.id}`;
        if (mode === "revoke") await operator("cancel-invitation", "other", inv.id);
        if (mode === "email") {
          await owner.client`update auth.users set email=${prefix + "-changed@example.invalid"} where id=${identity("other")}`;
          await owner.client`update auth.users set email=${address("other")} where id=${identity("other")}`;
        }
        assert.equal((await accept("other", token)).status, 400);
        if (mode === "expiry") await operator("cancel-invitation", "other", inv.id);
      }
    });
    await onboard("reviewer2");
    await t.test(
      "author saves a draft, attaches private PDF and submits through application",
      async () => {
        target = await draft(false, "document");
        const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
        const req = new Request(
          `${origin}/api/documents?submissionId=${target}&requestId=${randomUUID()}`,
          {
            method: "POST",
            headers: {
              origin,
              cookie: cookies.get("author")!,
              "Content-Type": "application/pdf",
              "X-Document-Name": "disposable.pdf",
            },
            body: pdf,
          },
        );
        const r = http ? await fetch(req) : await documents.handle(req);
        assert.equal(r.status, 201);
        await submit(target);
        const author = await (await call("/api/submissions?id=" + target, "author")).json();
        doc = author.documents[0].id;
        hidden = await draft(true);
        await submit(hidden);
      },
    );
    await t.test(
      "unassigned confidential data is absent from details, search, counts and downloads; admin is not reviewer",
      async () => {
        for (const name of ["reviewer", "reviewer2"]) {
          assert.equal((await call("/api/reviewer?id=" + hidden, name)).status, 404);
          const r = await (await call("/api/reviewer?search=Hidden", name)).json();
          assert.equal(r.total, 0);
          assert.equal(r.items.length, 0);
          assert.equal((await call(`/api/documents/${doc}/download`, name)).status, 404);
        }
        for (const name of ["author", "operator", "settings", "admin", "other", ""])
          assert.equal((await call("/api/reviewer", name)).status, 403);
        assert.equal(
          (await as("admin", (tx) => tx`select id from app.submissions where id=${hidden}`)).length,
          0,
        );
        if (http) {
          assert.equal((await call("/reviewer/submissions/" + hidden, "reviewer")).status, 404);
          assert.equal((await call("/reviewer", "other")).status, 403);
          const page = await call("/reviewer/invitation");
          assert.equal(page.status, 200);
          assert.match(page.headers.get("cache-control")!, /no-store/);
        }
      },
    );
    await t.test(
      "assignment rejects author, drafts, inactive reviewers, duplicate and concurrent grants",
      async () => {
        await assert.rejects(operator("assign", "author", target));
        const draftId = await draft();
        await assert.rejects(operator("assign", "reviewer", draftId));
        await assert.rejects(operator("assign", "other", target));
        await assert.rejects(operator("assign", "reviewer", target, null, undefined, 99), {
          code: "40001",
        });
        const results = await Promise.allSettled([
          operator("assign", "reviewer", target),
          operator("assign", "reviewer", target),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        const [a] =
          await owner.client`select id from app.reviewer_assignments where submission_id=${target} and reviewer_id=${identity("reviewer")} and status='active'`;
        assignment = String(a!["id"]);
        await operator("assign", "reviewer2", target);
        assert.equal(
          (await as("reviewer", (tx) => tx`select id from app.submissions where id=${hidden}`))
            .length,
          0,
        );
        await assert.rejects(
          as(
            "reviewer",
            (tx) =>
              tx`insert into app.reviewer_assignments(submission_id,revision,reviewer_id,assigned_by) values(${hidden},1,${identity("reviewer")},'forged')`,
          ),
        );
      },
    );
    await t.test(
      "dashboard counts, filters and twenty-row pages are scoped in PostgreSQL",
      async () => {
        // Explicit disposable pagination fixtures; the actual business lifecycle uses
        // the separately registered author and application requests above and below.
        const fixtures: string[] = [];
        for (let n = 0; n < 23; n++) {
          const [s] =
            await owner.client`insert into app.submissions(owner_id,title,confidential) values(${identity("author")},${"Pagination fixture " + n},true) returning id`;
          const id = String(s!["id"]);
          fixtures.push(id);
          await operator("assign", "reviewer2", id);
        }
        const first = await (await call("/api/reviewer?search=Pagination", "reviewer2")).json();
        const second = await (
          await call("/api/reviewer?search=Pagination&page=2", "reviewer2")
        ).json();
        assert.equal(first.total, 23);
        assert.equal(first.items.length, 20);
        assert.equal(second.total, 23);
        assert.equal(second.items.length, 3);
        assert.equal(
          new Set([...first.items, ...second.items].map((r: { id: string }) => r.id)).size,
          23,
        );
        assert.equal(
          (await (await call("/api/reviewer?search=Pagination", "reviewer")).json()).total,
          0,
        );
        assert.equal(
          (
            await (
              await call("/api/reviewer?search=Pagination&status=accepted", "reviewer2")
            ).json()
          ).total,
          0,
        );
        for (const id of fixtures) {
          const [a] =
            await owner.client`select id from app.reviewer_assignments where submission_id=${id} and status='active'`;
          await operator("revoke-assignment", "reviewer2", String(a!["id"]));
        }
      },
    );
    await t.test(
      "an active reviewer cannot be assigned or decide their own submission",
      async () => {
        const r = await call("/api/submissions", "reviewer", {
          action: "save",
          version: 0,
          kind: "idea",
          title: "Reviewer own work",
          category: "General",
          abstract: "A meaningful description of the reviewer's own theological work.",
          keywords: [],
          confidential: true,
        });
        assert.equal(r.status, 200);
        const own = String((await r.json()).id);
        assert.equal(
          (await call("/api/submissions", "reviewer", { action: "submit", id: own, version: 1 }))
            .status,
          200,
        );
        await assert.rejects(operator("assign", "reviewer", own));
        assert.equal((await call("/api/reviewer", "reviewer", decision(own, 2))).status, 404);
        assert.equal((await call("/api/reviewer?id=" + own, "reviewer")).status, 404);
      },
    );
    await t.test(
      "assigned detail uses minimal author data and audited private download",
      async () => {
        await login("reviewer");
        const d = await detail(target);
        assert.equal(d.submission.revision, 1);
        assert.ok(d.author.name);
        assert.ok(!JSON.stringify(d).includes("@example.invalid"));
        assert.equal(d.documents.length, 1);
        const r = await call(`/api/documents/${doc}/download`, "reviewer");
        assert.equal(r.status, 200);
        await r.arrayBuffer();
        const events =
          await owner.client`select action from app.audit_events where document_id=${doc}`;
        assert.ok(events.some((e) => e["action"] === "document.download.authorized"));
        assert.ok(events.some((e) => e["action"] === "document.download.started"));
      },
    );
    await t.test(
      "runtime direct status/decision and metadata writes remain denied; forged identity is rejected",
      async () => {
        for (const name of ["reviewer", "reviewer2", "admin", "author"]) {
          await assert.rejects(
            as(name, (tx) => tx`update app.submissions set status='accepted' where id=${target}`),
            { code: "42501" },
          );
          await assert.rejects(
            as(
              name,
              (tx) =>
                tx`insert into app.review_decisions(submission_id,reviewer_id,outcome) values(${target},${identity(name)},'accepted')`,
            ),
            { code: "42501" },
          );
          await assert.rejects(
            as(
              name,
              (tx) =>
                tx`update app.submissions set confidential=false,owner_id=${identity(name)},title='forged' where id=${target}`,
            ),
            { code: "42501" },
          );
        }
        assert.equal(
          (
            await call(
              "/api/reviewer",
              "reviewer",
              decision(target, 2, "under_review", { reviewerId: identity("reviewer2") }),
            )
          ).status,
          400,
        );
        assert.equal((await call("/api/reviewer", "author", decision(target, 2))).status, 403);
      },
    );
    await t.test(
      "explicit transition validation and concurrency have one start-review winner",
      async () => {
        assert.equal(
          (await call("/api/reviewer", "reviewer", decision(target, 2, "accepted"))).status,
          400,
        );
        const r = await Promise.all([
          call("/api/reviewer", "reviewer", decision(target, 2)),
          call("/api/reviewer", "reviewer2", decision(target, 2)),
        ]);
        assert.deepEqual(r.map((v) => v.status).sort(), [200, 409]);
        assert.equal((await detail(target)).submission.status, "under_review");
        assert.equal(
          (
            await call(
              "/api/reviewer",
              "reviewer",
              decision(target, 3, "returned", { feedback: " \n " }),
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              "/api/reviewer",
              "reviewer",
              decision(target, 3, "accepted", { privateNotes: "short" }),
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      "audit or immutable-history insertion failure rolls back status, history and outbox",
      async () => {
        for (const table of [
          "audit_events",
          "review_decisions",
          "submission_events",
          "reviewer_notifications",
        ]) {
          const [before] =
            await owner.client`select (select count(*) from app.review_decisions where submission_id=${target}) as history,(select count(*) from app.reviewer_notifications where submission_id=${target}) as notifications,(select version from app.submissions where id=${target}) as version`;
          await owner.client.unsafe(
            "create function app.phase3e_injected_failure() returns trigger language plpgsql as $$ begin raise exception 'Injected failure'; end $$",
          );
          try {
            await owner.client.unsafe(
              `create trigger phase3e_failure before insert on app.${table} for each row execute function app.phase3e_injected_failure()`,
            );
            assert.equal(
              (await call("/api/reviewer", "reviewer", decision(target, 3, "returned"))).status,
              503,
            );
          } finally {
            await owner.client.unsafe(`drop trigger if exists phase3e_failure on app.${table}`);
            await owner.client`drop function app.phase3e_injected_failure()`;
          }
          const [after] =
            await owner.client`select (select count(*) from app.review_decisions where submission_id=${target}) as history,(select count(*) from app.reviewer_notifications where submission_id=${target}) as notifications,(select version from app.submissions where id=${target}) as version`;
          assert.deepEqual(after, before);
        }
      },
    );
    await t.test(
      "return decision is atomic and idempotent; author sees safe revision feedback",
      async () => {
        const v = decision(target, 3, "returned");
        const results = await Promise.all([
          call("/api/reviewer", "reviewer", v),
          call("/api/reviewer", "reviewer", v),
        ]);
        assert.deepEqual(
          results.map((r) => r.status),
          [200, 200],
        );
        const [count] =
          await owner.client`select count(*)::int as n from app.review_decisions where request_id=${v.requestId}`;
        assert.equal(count!["n"], 1);
        assert.equal(
          (
            await call("/api/reviewer", "reviewer", {
              ...v,
              feedback: "A different intent using the same key.",
            })
          ).status,
          409,
        );
        const author = await (await call("/api/submissions?id=" + target, "author")).json();
        assert.equal(author.submission.status, "returned");
        assert.equal(author.feedback[0].author_feedback, v.feedback);
        assert.equal(author.feedback[0].revision, 1);
        assert.ok(!JSON.stringify(author).includes(v.privateNotes));
        assert.equal(
          (
            await as(
              "author",
              (tx) => tx`select * from app.review_decisions where submission_id=${target}`,
            )
          ).length,
          0,
        );
        const [n] =
          await owner.client`select count(*)::int as n from app.reviewer_notifications where event_key like 'decision:%' and submission_id=${target}`;
        assert.equal(n!["n"], 1);
      },
    );
    await t.test(
      "amendment preserves prior feedback and decisions; old assignments lose new-revision access",
      async () => {
        await assert.rejects(operator("assign", "reviewer", target));
        assert.equal(
          (await call("/api/submissions", "author", { action: "amend", id: target, version: 4 }))
            .status,
          200,
        );
        assert.equal((await call("/api/reviewer?id=" + target, "reviewer")).status, 404);
        assert.equal((await call(`/api/documents/${doc}/download`, "reviewer")).status, 404);
        const d = await (await call("/api/submissions?id=" + target, "author")).json();
        assert.equal(d.submission.revision, 2);
        assert.equal(d.feedback[0].revision, 1);
        await submit(target, 5);
        assert.equal((await call("/api/reviewer?id=" + target, "reviewer")).status, 404);
        await operator("assign", "reviewer", target);
        await operator("assign", "reviewer2", target);
        assert.equal((await detail(target)).history.length, 0);
      },
    );
    await t.test(
      "new revision start then conflicting final decisions have one winner",
      async () => {
        assert.equal((await call("/api/reviewer", "reviewer", decision(target, 6))).status, 200);
        const a = decision(target, 7, "accepted"),
          b = decision(target, 7, "returned");
        // Two genuinely concurrent, valid final decisions; whichever wins is authoritative.
        const results = await Promise.all([
          call("/api/reviewer", "reviewer", a),
          call("/api/reviewer", "reviewer2", b),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        const d = await detail(target);
        assert.equal(d.submission.version, 8);
        if (d.submission.status === "returned") {
          assert.equal(
            (await call("/api/submissions", "author", { action: "amend", id: target, version: 8 }))
              .status,
            200,
          );
          await submit(target, 9);
          await operator("assign", "reviewer", target);
          assert.equal((await call("/api/reviewer", "reviewer", decision(target, 10))).status, 200);
          assert.equal(
            (await call("/api/reviewer", "reviewer", decision(target, 11, "accepted"))).status,
            200,
          );
        }
        const repo = await (await call("/api/repository?id=" + target, "other")).json();
        assert.equal(repo.submission.status, "accepted");
        const author = await (await call("/api/submissions?id=" + target, "author")).json();
        assert.ok(
          author.feedback.some(
            (f: { revision: number; outcome: string }) =>
              f.revision === 1 && f.outcome === "returned",
          ),
        );
      },
    );
    await t.test(
      "confidential acceptance stays outside repository and unrelated assignment access",
      async () => {
        await operator("assign", "reviewer", hidden);
        assert.equal((await call("/api/reviewer", "reviewer", decision(hidden, 2))).status, 200);
        assert.equal(
          (await call("/api/reviewer", "reviewer", decision(hidden, 3, "accepted"))).status,
          200,
        );
        assert.equal((await call("/api/repository?id=" + hidden, "other")).status, 404);
        assert.equal((await call("/api/reviewer?id=" + hidden, "reviewer2")).status, 404);
        assert.equal(
          (await (await call("/api/repository?search=Hidden", "other")).json()).total,
          0,
        );
      },
    );
    await t.test(
      "revoking an assignment immediately blocks details and download audits",
      async () => {
        const [a] =
          await owner.client`select id from app.reviewer_assignments where submission_id=${target} and reviewer_id=${identity("reviewer")} and revision=(select revision from app.submissions where id=${target}) and status='active'`;
        await operator("revoke-assignment", "reviewer", String(a!["id"]));
        assert.equal((await call("/api/reviewer?id=" + target, "reviewer")).status, 404);
        // Accepted non-confidential repository bytes remain available through ordinary clergy access.
        await operator(
          "revoke-assignment",
          "reviewer",
          String(
            (
              await owner.client`select id from app.reviewer_assignments where submission_id=${hidden} and reviewer_id=${identity("reviewer")} and status='active'`
            )[0]!["id"],
          ),
        );
        assert.equal((await call("/api/reviewer?id=" + hidden, "reviewer")).status, 404);
        assert.equal(
          (
            await as("reviewer", (tx) => tx`select app.can_review_submission(${hidden}) as allowed`)
          )[0]!["allowed"],
          false,
        );
        assert.ok(assignment);
      },
    );
    await t.test(
      "live account, consent and role checks deny protected reviewer operations",
      async () => {
        for (const state of ["pending", "rejected", "suspended"]) {
          await owner.client`update app.clergy_profiles set approval_status=${state} where user_id=${identity("reviewer2")}`;
          assert.equal((await call("/api/reviewer", "reviewer2")).status, 403);
          await owner.client`update app.clergy_profiles set approval_status='approved' where user_id=${identity("reviewer2")}`;
        }
        await login("reviewer2");
        await as(
          "reviewer2",
          (tx) =>
            tx`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(app.request_user_id(),'repository-v1','repository','withdrawn')`,
        );
        assert.equal((await call("/api/reviewer", "reviewer2")).status, 403);
        await as(
          "reviewer2",
          (tx) =>
            tx`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(app.request_user_id(),'repository-v1','repository','accepted')`,
        );
        await owner.client`update auth.users set email_verified=false where id=${identity("reviewer2")}`;
        assert.equal((await call("/api/reviewer", "reviewer2")).status, 403);
        await owner.client`update auth.users set email_verified=true where id=${identity("reviewer2")}`;
        await operator("revoke-reviewer", "reviewer2");
        assert.equal((await call("/api/reviewer", "reviewer2")).status, 403);
        assert.equal(
          (await owner.client`select id from auth.sessions where user_id=${identity("reviewer2")}`)
            .length,
          0,
        );
      },
    );
    await t.test("immutable reviewer history cannot be updated, deleted or truncated", async () => {
      for (const table of ["review_decisions", "reviewer_events"]) {
        const [row] = await owner.client.unsafe(`select id from app.${table} limit 1`);
        assert.ok(row);
        await assert.rejects(
          owner.client.unsafe(`update app.${table} set created_at=now() where id=$1`, [row["id"]]),
          { code: "55000" },
        );
        await assert.rejects(
          owner.client.unsafe(`delete from app.${table} where id=$1`, [row["id"]]),
          { code: "55000" },
        );
        await assert.rejects(owner.client.unsafe(`truncate app.${table}`), { code: "55000" });
      }
    });
    await t.test(
      "notification failures preserve decisions; stable keys, sender snapshots, leases and retry exhaustion",
      async () => {
        const [n] =
          await owner.client`select id from app.reviewer_notifications where submission_id=${target} and kind='submission_returned' order by created_at limit 1`;
        assert.ok(n);
        provider.fail = true;
        assert.equal(
          await deliverReviewerNotifications(owner, email, origin, secret, 1, String(n["id"])),
          0,
        );
        const [failed] =
          await owner.client`select attempts,last_error,sender_from from app.reviewer_notifications where id=${n["id"]}`;
        assert.equal(failed!["attempts"], 1);
        assert.equal(failed!["last_error"], "delivery_failed");
        await owner.client`update app.reviewer_notifications set available_at=now() where id=${n["id"]}`;
        provider.fail = false;
        const r = await Promise.all([
          deliverReviewerNotifications(owner, email, origin, secret, 1, String(n["id"])),
          deliverReviewerNotifications(owner, email, origin, secret, 1, String(n["id"])),
        ]);
        assert.equal(r[0]! + r[1]!, 1);
        const mail = provider.messages.at(-1)!;
        assert.equal(mail.key, "reviewer:" + n["id"]);
        assert.ok(!mail.text.includes("Internal note"));
        assert.ok(mail.html);
        assert.equal(mail.from, failed!["sender_from"]);
        assert.equal(
          await deliverReviewerNotifications(owner, email, origin, secret, 1, String(n["id"])),
          0,
        );
        const inv = await issue("other");
        const [queued] =
          await owner.client`select id from app.reviewer_notifications where invitation_id=${inv.id}`;
        await owner.client`update app.reviewer_notifications set attempts=7,available_at=now()-interval '1 minute',lease_token=${randomUUID()} where id=${queued!["id"]}`;
        provider.fail = true;
        assert.equal(
          await deliverReviewerNotifications(
            owner,
            email,
            origin,
            secret,
            1,
            String(queued!["id"]),
          ),
          0,
        );
        provider.fail = false;
        await owner.client`update app.reviewer_notifications set available_at=now() where id=${queued!["id"]}`;
        assert.equal(
          await deliverReviewerNotifications(
            owner,
            email,
            origin,
            secret,
            1,
            String(queued!["id"]),
          ),
          0,
        );
        const [ex] =
          await owner.client`select attempts from app.reviewer_notifications where id=${queued!["id"]}`;
        assert.equal(ex!["attempts"], 8);
      },
    );
  } finally {
    if (child) {
      child.kill("SIGTERM");
      if (child.exitCode === null) await once(child, "exit");
    }
    globalThis.fetch = originalFetch;
    // Drain services before deleting only our disposable identities/evidence.
    await runtime.close();
    await owner.client.begin(async (tx) => {
      for (const table of [
        "review_decisions",
        "reviewer_events",
        "submission_events",
        "audit_events",
        "popia_consent_events",
        "account_approval_events",
      ])
        await tx.unsafe(`alter table app.${table} disable trigger user`);
      await tx`delete from app.reviewer_notifications where user_id=any(${ids})`;
      await tx`delete from app.reviewer_events where reviewer_id=any(${ids})`;
      await tx`delete from app.review_decisions where reviewer_id=any(${ids})`;
      await tx`delete from app.reviewer_assignments where reviewer_id=any(${ids})`;
      await tx`delete from app.reviewer_invitations where user_id=any(${ids})`;
      await tx`delete from app.submission_events where actor_id=any(${ids})`;
      await tx`delete from app.documents where submission_id in(select id from app.submissions where owner_id=any(${ids}))`;
      await tx`delete from app.submissions where owner_id=any(${ids})`;
      await tx`delete from app.audit_events where actor_id=any(${ids}) or target_user_id=any(${ids})`;
      await tx`delete from app.popia_consent_events where user_id=any(${ids})`;
      await tx`delete from app.account_approval_events where user_id=any(${ids})`;
      await tx`delete from app.approval_notifications where user_id=any(${ids})`;
      await tx`delete from app.settings_managers where user_id=any(${ids})`;
      await tx`delete from app.role_assignments where user_id=any(${ids})`;
      await tx`delete from app.clergy_profiles where user_id=any(${ids})`;
      await tx`delete from auth.users where id=any(${ids})`;
      await tx`delete from auth.verifications where identifier like ${"%" + prefix + "%"}`;
      await tx`update app.email_settings set transactional_enabled=${initial!["transactional_enabled"]},notifications_enabled=${initial!["notifications_enabled"]}`;
      for (const table of [
        "review_decisions",
        "reviewer_events",
        "submission_events",
        "audit_events",
        "popia_consent_events",
        "account_approval_events",
      ])
        await tx.unsafe(`alter table app.${table} enable trigger user`);
    });
    if (http) {
      for (const file of await readdir(".local/email")) {
        const m = JSON.parse(await readFile(".local/email/" + file, "utf8"));
        if (String(m.to).startsWith(prefix)) await unlink(".local/email/" + file);
      }
    }
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});
