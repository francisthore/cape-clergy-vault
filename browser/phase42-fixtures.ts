import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { hashPassword } from "better-auth/crypto";
import type { Page } from "@playwright/test";
import { connectLocalDatabase } from "../database/connection.server.ts";
import { connectLocalRuntime } from "../database/runtime.server.ts";
import { connectLocalScanner } from "../database/scanner.server.ts";
import { connectLocalNotifications } from "../database/notifications.server.ts";
import {
  readDisposableManifest,
  assertDisposableDatabase,
} from "../database/disposable-phase41b.server.ts";
import { createInvitationProof } from "../src/lib/reviews/tokens.server.ts";
import { registrationNotice } from "../src/lib/auth/registration.ts";
import { runScanWorker } from "../src/lib/scanning/worker.server.ts";
import { BouncerScanner } from "../src/lib/scanning/bouncer.server.ts";
import { LocalPrivateStorageProvider } from "../src/lib/documents/storage.server.ts";
import { configuredEmail } from "../src/lib/email/service.server.ts";
import { deliverApprovalNotifications } from "../src/lib/approvals/notifications.server.ts";
export const origin = "http://localhost:3220",
  password = "Synthetic Phase42 browser passphrase";
export async function fixtures42() {
  const manifest = await readDisposableManifest();
  const owner = await connectLocalDatabase(),
    runtime = await connectLocalRuntime(),
    scanner = await connectLocalScanner(),
    worker = await connectLocalNotifications();
  await assertDisposableDatabase(owner.client, manifest);
  const prefix = "p42-browser-" + randomUUID();
  const ids = new Map<string, string>();
  const address = (name: string) => `${prefix}-${name}@example.invalid`;
  const id = (name: string) => {
    const who = ids.get(name);
    assert.ok(who);
    return who;
  };
  const hash = await hashPassword(password);
  async function seed(name: string, status = "approved", roles: string[] = []) {
    const who = `${prefix}-${name}`;
    ids.set(name, who);
    await owner.client`insert into auth.users(id,name,email,email_verified) values(${who},'Synthetic browser clergy',${address(name)},true)`;
    await owner.client`insert into auth.accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) values(${randomUUID()},${who},'credential',${who},${hash},now(),now())`;
    await owner.client`insert into app.clergy_profiles(user_id,full_name,title,parish,approval_status) values(${who},'Synthetic clergy','Rev.','Synthetic parish',${status})`;
    for (const role of ["clergy", ...roles])
      await owner.client`insert into app.role_assignments(user_id,role) values(${who},${role})`;
    await owner.client`insert into app.popia_consent_events(user_id,notice_version,purpose,action) values(${who},${registrationNotice.version},'repository','accepted')`;
  }
  await seed("author");
  await seed("pending", "pending");
  await seed("approver", "approved", ["approver"]);
  await seed("multi", "approved", ["approver"]);
  await owner.client`insert into app.settings_managers(user_id) values(${id("multi")})`;
  const proof = createInvitationProof("Synthetic-phase42-proof-secret-minimum-32", id("multi"));
  await owner.client`select app.reviewer_operator('invite',${id("multi")},null,${proof.digest},${proof.sealed},${"INVITE " + id("multi")},null)`;
  await runtime.client.begin(async (tx) => {
    await tx`select set_config('cape.user_id',${id("multi")},true)`;
    await tx`select app.accept_reviewer_invitation(${proof.digest})`;
  });
  const cookies = new Map<string, Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>>>();
  async function login(page: Page, name: string) {
    if (cookies.has(name)) {
      await page.context().clearCookies();
      await page.context().addCookies(cookies.get(name)!);
      const response = await page.request.get(origin + "/api/auth/account");
      if (response.ok() && (await response.json()).status !== "signed-out") {
        await page.goto("/account");
        return;
      }
    }
    await page.context().clearCookies();
    let response = await page.request.post(origin + "/api/auth/sign-in/email", {
      headers: { origin },
      data: { email: address(name), password },
    });
    if (response.status() === 429) {
      // Honour the real shared limiter; never alter buckets or application limits.
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(60, Number(response.headers()["retry-after"]) || 60) * 1000),
      );
      response = await page.request.post(origin + "/api/auth/sign-in/email", {
        headers: { origin },
        data: { email: address(name), password },
      });
    }
    assert.equal(response.status(), 200);
    cookies.set(name, await page.context().cookies());
    await page.goto("/account");
  }
  async function capture(name: string, subject: string) {
    for (const file of await readdir(".local/email")) {
      const mail = JSON.parse(await readFile(".local/email/" + file, "utf8"));
      if (mail.to === address(name) && mail.subject.toLowerCase().includes(subject))
        return mail as { text: string };
    }
    throw Error("Synthetic captured email not found");
  }
  async function registered(name: string) {
    const [u] = await owner.client`select id from auth.users where email=${address(name)}`;
    assert.ok(u);
    ids.set(name, String(u["id"]));
  }
  async function deliver(name: string, kind: string) {
    const [row] =
      await owner.client`select id from app.approval_notifications where user_id=${id(name)} and kind=${kind} and delivered_at is null order by created_at desc limit 1`;
    assert.ok(row);
    assert.equal(
      await deliverApprovalNotifications(
        worker,
        configuredEmail(origin, { NODE_ENV: "test", EMAIL_PROVIDER: "development" }, owner.client),
        origin,
        1,
        String(row["id"]),
      ),
      1,
    );
  }
  async function scan(documentId: string) {
    const [doc] =
      await owner.client`select sha256,byte_size from app.documents where id=${documentId}`;
    assert.ok(doc);
    const scanId = "scan_" + randomUUID();
    let posts = 0,
      polls = 0;
    const provider = new BouncerScanner({
      apiKey: "synthetic-only",
      uploadHost: "",
      fetch: (async (input, init) => {
        const url = String(input);
        if (url.endsWith("/usage"))
          return Response.json({
            status: "success",
            data: {
              tier: "free",
              period: new Date().toISOString().slice(0, 7),
              scans_used: 0,
              scans_limit: 500,
              resets_at: new Date(
                Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1),
              ).toISOString(),
            },
          });
        if (init?.method === "POST") {
          posts++;
          for await (const part of init.body as unknown as AsyncIterable<Uint8Array>) void part;
          return Response.json(
            { status: "success", data: { scan_id: scanId, status: "pending" } },
            { status: 202 },
          );
        }
        polls++;
        return Response.json({
          status: "success",
          data: {
            scan_id: scanId,
            status: "completed",
            verdict: "clean",
            file: { sha256: doc["sha256"], size: Number(doc["byte_size"]) },
          },
        });
      }) as typeof fetch,
    });
    const storage = new LocalPrivateStorageProvider(".local/browser-storage");
    await runScanWorker(scanner.client, storage, provider, 1, documentId);
    await owner.client`update app.document_scans set available_at=now() where document_id=${documentId}`;
    await runScanWorker(scanner.client, storage, provider, 1, documentId);
    assert.equal(posts, 1);
    assert.equal(polls, 1);
  }
  return {
    owner,
    runtime,
    id,
    address,
    login,
    capture,
    registered,
    deliver,
    scan,
    close: () => Promise.all([owner.close(), runtime.close(), scanner.close(), worker.close()]),
  };
}
