import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { test } from "node:test";
import { createEmailVerificationToken } from "better-auth/api";
import { connectLocalDatabase } from "./connection.server.ts";
import { connectLocalRuntime } from "./runtime.server.ts";
import { createAuthService } from "../src/lib/auth/service.server.ts";
import { EmailService, TestEmailProvider } from "../src/lib/email/service.server.ts";

// A network deny switch ensures no provider or library can accidentally send mail.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("External network forbidden in auth tests");
};
const baseURL = "http://localhost:3211";
const password = "a long unique local test passphrase";
const profile = {
  fullName: "Local Test Clergy",
  title: "Rev.",
  parish: "Local test ministry",
  phone: "",
  acknowledged: true,
  noticeVersion: "repository-v1",
};

test("Phase 3A HTTP auth, email and negative authorization using restricted PostgreSQL", async (t) => {
  const owner = await connectLocalDatabase();
  const runtime = await connectLocalRuntime();
  const prefix = `phase3a-${randomUUID()}`;
  const provider = new TestEmailProvider();
  const mail = new EmailService(provider, {
    from: "Local <local@example.invalid>",
    origin: baseURL,
  });
  const secret = randomBytes(32).toString("hex");
  const service = createAuthService(runtime, mail, { secret, baseURL });
  const email = `${prefix}@example.invalid`;
  const request = (path: string, body?: unknown, cookie = "", origin = baseURL) =>
    service.handle(
      new Request(`${baseURL}/api/auth/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { origin, cookie, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const signup = (address = email, extra = {}) =>
    request("register", {
      ...profile,
      email: address,
      password,
      confirmPassword: password,
      ...extra,
    });
  const link = (subject: string, address = email) => {
    const message = provider.messages.findLast(
      (m) => m.to === address && m.subject.startsWith(subject),
    );
    assert.ok(message, `Captured ${subject}`);
    return message.text.match(/https?:\/\/[^\s]+/)![0];
  };
  const open = (url: string) => service.handle(new Request(url));
  const cookies = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
  const headers = (cookie: string) => new Headers({ cookie });
  let id = "";
  let cookie = "";
  try {
    await t.test(
      "strict registration validation, origin, unsafe callbacks and alternate endpoints",
      async () => {
        assert.equal(
          (await signup(email, { role: "admin", userId: "forged", approvalStatus: "approved" }))
            .status,
          400,
        );
        assert.equal((await signup(email, { acknowledged: false })).status, 400);
        assert.equal((await signup(email, { confirmPassword: "different" })).status, 400);
        assert.equal((await request("register", {}, "", "https://attacker.invalid")).status, 403);
        assert.equal(
          (await request("sign-up/email", { name: "Attacker", email, password })).status,
          404,
        );
        assert.equal(
          (
            await open(
              `${baseURL}/api/auth/verify-email?token=x&callbackURL=https://attacker.invalid`,
            )
          ).status,
          400,
        );
        assert.equal((await request("get-session")).status, 404);
      },
    );
    await t.test(
      "registration, explicit consent, clergy-only pending profile and no session",
      async () => {
        const response = await signup(`  ${email.toUpperCase()}  `);
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal(cookies(response), "");
        const [user] =
          await owner.client`select id,email_verified from auth.users where email=${email}`;
        assert.ok(user);
        id = user["id"];
        assert.equal(user["email_verified"], false);
        assert.equal(
          (
            await owner.client`select approval_status from app.clergy_profiles where user_id=${id}`
          )[0]!["approval_status"],
          "pending",
        );
        assert.deepEqual(
          (await owner.client`select role from app.role_assignments where user_id=${id}`).map(
            (r) => r["role"],
          ),
          ["clergy"],
        );
        assert.equal(
          (await owner.client`select * from app.popia_consent_events where user_id=${id}`).length,
          1,
        );
        assert.equal(
          (await owner.client`select * from auth.sessions where user_id=${id}`).length,
          0,
        );
        link("Verify");
        assert.equal((await request("sign-in/email", { email, password })).status, 401);
        const duplicate = await signup();
        assert.equal(duplicate.status, 200);
        assert.equal(
          (await owner.client`select * from app.clergy_profiles where user_id=${id}`).length,
          1,
        );
      },
    );
    await t.test(
      "verification rejects tampered, expired and replayed tokens; verification grants no approval",
      async () => {
        const verification = link("Verify");
        const expiredJWT = await createEmailVerificationToken(secret, email, undefined, -60, {
          userId: id,
        });
        const expiredHash = createHash("sha256").update(expiredJWT).digest("hex");
        await owner.client`insert into auth.verifications(id,identifier,value,expires_at) values (${expiredHash},${"email-once:" + expiredHash},${expiredHash},(now() at time zone 'UTC')+interval '1 hour')`;
        const expiredURL = new URL(verification);
        expiredURL.searchParams.set("token", expiredJWT);
        assert.match((await open(expiredURL.href)).headers.get("location")!, /error=/);

        const digest = createHash("sha256")
          .update(new URL(verification).searchParams.get("token")!)
          .digest("hex");
        await owner.client`update auth.verifications set expires_at=(now() at time zone 'UTC')-interval '1 second' where id=${digest}`;
        assert.match((await open(verification)).headers.get("location")!, /error=invalid/);
        await owner.client`update auth.verifications set expires_at=(now() at time zone 'UTC')+interval '1 hour' where id=${digest}`;
        const bad = new URL(verification);
        bad.searchParams.set("token", "invalid");
        assert.match((await open(bad.href)).headers.get("location")!, /error=invalid/);
        const responses = await Promise.all([open(verification), open(verification)]);
        assert.equal(
          responses.filter((r) => r.headers.get("location")?.includes("error=invalid")).length,
          1,
        );
        assert.equal(
          (await owner.client`select email_verified from auth.users where id=${id}`)[0]![
            "email_verified"
          ],
          true,
        );
        assert.equal(
          (
            await owner.client`select count(*)::int as n from app.approval_notifications where user_id=${id} and kind='pending'`
          )[0]!["n"],
          1,
        );
        assert.equal(
          (
            await owner.client`select approval_status from app.clergy_profiles where user_id=${id}`
          )[0]!["approval_status"],
          "pending",
        );
      },
    );
    await t.test(
      "verified login uses HttpOnly SameSite cookies; pending protected operations denied",
      async () => {
        const response = await request("sign-in/email", { email, password });
        assert.equal(response.status, 200, await response.clone().text());
        assert.ok(!("token" in (await response.clone().json())));
        const setCookie = response.headers.getSetCookie().join(";");
        assert.match(setCookie, /HttpOnly/i);
        assert.match(setCookie, /SameSite=Lax/i);
        cookie = cookies(response);
        assert.ok(cookie);
        assert.equal(
          (await (await request("account", undefined, cookie)).json()).status,
          "pending",
        );
        await assert.rejects(service.withApprovedDatabase(headers(cookie), async () => 1));
        await assert.rejects(service.withApprovedDatabase(new Headers(), async () => 1));
        assert.equal(
          (await request("account", undefined, "better-auth.session_token=forged")).status,
          200,
        );
        assert.equal(
          (await (await request("account", undefined, "better-auth.session_token=forged")).json())
            .status,
          "signed-out",
        );
      },
    );
    await t.test("concurrent logins rotate session IDs and HTTPS cookies are Secure", async () => {
      const logins = await Promise.all([
        request("sign-in/email", { email, password }),
        request("sign-in/email", { email, password }),
      ]);
      assert.ok(logins.every((response) => response.status === 200));
      assert.notEqual(cookies(logins[0]!), cookies(logins[1]!));
      const secureOrigin = "https://vault.example.invalid";
      const secureService = createAuthService(runtime, mail, { secret, baseURL: secureOrigin });
      const secure = await secureService.handle(
        new Request(`${secureOrigin}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { origin: secureOrigin, "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        }),
      );
      assert.equal(secure.status, 200);
      assert.match(secure.headers.getSetCookie().join(";"), /; Secure/i);
      assert.match(secure.headers.getSetCookie().join(";"), /HttpOnly/i);
    });
    await t.test(
      "concurrent provisioning is idempotent, cannot mutate existing profiles or grant roles",
      async () => {
        await Promise.all([
          request("complete-profile", profile, cookie),
          request("complete-profile", { ...profile, fullName: "Changed" }, cookie),
        ]);
        assert.equal(
          (await owner.client`select full_name from app.clergy_profiles where user_id=${id}`)[0]![
            "full_name"
          ],
          profile.fullName,
        );
        assert.equal(
          (await owner.client`select * from app.role_assignments where user_id=${id}`).length,
          1,
        );
        assert.equal(
          (await owner.client`select * from app.account_approval_events where user_id=${id}`)
            .length,
          1,
        );
        assert.equal(
          (await request("complete-profile", { ...profile, role: "admin" }, cookie)).status,
          400,
        );
        await assert.rejects(
          runtime.client`select app.provision_clergy(${id},'Forged','Rev.','Test','',true,'repository-v1')`,
        );
      },
    );
    await t.test(
      "approved still needs RLS consent; rejected denies; suspension revokes existing sessions",
      async () => {
        await owner.client`update app.clergy_profiles set approval_status='approved' where user_id=${id}`;
        assert.equal(
          await service.withApprovedDatabase(headers(cookie), async () => "eligible"),
          "eligible",
        );
        await owner.client`update app.clergy_profiles set approval_status='rejected' where user_id=${id}`;
        assert.equal(
          (await (await request("account", undefined, cookie)).json()).status,
          "rejected",
        );
        await assert.rejects(service.withApprovedDatabase(headers(cookie), async () => 1));
        await owner.client`update app.clergy_profiles set approval_status='suspended' where user_id=${id}`;
        assert.equal(
          (await owner.client`select * from auth.sessions where user_id=${id}`).length,
          0,
        );
        assert.equal(
          (await (await request("account", undefined, cookie)).json()).status,
          "signed-out",
        );
        assert.equal((await request("sign-in/email", { email, password })).status, 401);
        await owner.client`update app.clergy_profiles set approval_status='pending' where user_id=${id}`;
      },
    );
    await t.test(
      "password reset expires, invalid/reused tokens fail, changes password and revokes sessions",
      async () => {
        const login = await request("sign-in/email", { email, password });
        cookie = cookies(login);
        const missing = await request("request-password-reset", {
          email: `${prefix}-missing@example.invalid`,
        });
        const real = await request("request-password-reset", { email });
        assert.deepEqual(await missing.json(), await real.json());
        const reset = link("Reset");
        const token = new URL(reset).pathname.split("/").at(-1)!;
        const callback = await open(reset);
        assert.match(callback.headers.get("location")!, /token=/);
        const [resetRecord] =
          await owner.client`select * from auth.verifications where value=${id}`;
        assert.ok(resetRecord);
        await owner.client`update auth.verifications set expires_at=(now() at time zone 'UTC')-interval '1 second' where value=${id}`;
        assert.equal(
          (await request("reset-password", { token, newPassword: password + " new" })).status,
          400,
        );
        // Better Auth cleans expired rows; restore only this synthetic fixture to test the valid flow.
        await owner.client`insert into auth.verifications(id,identifier,value,expires_at) values (${resetRecord["id"]},${resetRecord["identifier"]},${id},(now() at time zone 'UTC')+interval '1 hour') on conflict (id) do update set expires_at=excluded.expires_at`;
        assert.equal(
          (await request("reset-password", { token: "invalid", newPassword: password })).status,
          400,
        );
        assert.equal(
          (await request("reset-password", { token, newPassword: password + " new" })).status,
          200,
        );
        assert.equal(
          (await request("reset-password", { token, newPassword: password + " other" })).status,
          400,
        );
        assert.equal(
          (await (await request("account", undefined, cookie)).json()).status,
          "signed-out",
        );
        assert.equal((await request("sign-in/email", { email, password })).status, 401);
        const loginNew = await request("sign-in/email", { email, password: password + " new" });
        assert.equal(loginNew.status, 200);
        cookie = cookies(loginNew);
        assert.equal((await request("sign-out", {}, cookie)).status, 200);
        assert.equal(
          (await (await request("account", undefined, cookie)).json()).status,
          "signed-out",
        );
      },
    );
    await t.test(
      "mail delivery failures observable and recovery possible; public recovery remains generic",
      async () => {
        provider.fail = true;
        const address = `${prefix}-mail@example.invalid`;
        assert.equal((await signup(address)).status, 503);
        assert.equal(
          (await owner.client`select * from auth.users where email=${address}`).length,
          1,
        );
        const failure = await request("send-verification-email", { email: address });
        assert.equal(failure.status, 200);
        provider.fail = false;
        // New service simulates restart, resetting only process-local limiter.
        const restarted = createAuthService(runtime, mail, { secret, baseURL });
        const response = await restarted.handle(
          new Request(`${baseURL}/api/auth/send-verification-email`, {
            method: "POST",
            headers: { origin: baseURL, "content-type": "application/json" },
            body: JSON.stringify({ email: address }),
          }),
        );
        assert.equal(response.status, 200);
        link("Verify", address);
      },
    );
    await t.test(
      "partial provisioning failure leaves recoverable identity, verified session completes profile",
      async () => {
        const address = `${prefix}-recover@example.invalid`;
        await owner.client`revoke execute on function app.provision_clergy(text,text,text,text,text,boolean,text) from cape_clergy_runtime`;
        try {
          assert.equal((await signup(address)).status, 503);
        } finally {
          await owner.client`grant execute on function app.provision_clergy(text,text,text,text,text,boolean,text) to cape_clergy_runtime`;
        }
        await open(link("Verify", address));
        const login = await request("sign-in/email", { email: address, password });
        const recoveryCookie = cookies(login);
        assert.equal(
          (await (await request("account", undefined, recoveryCookie)).json()).status,
          "incomplete",
        );
        await assert.rejects(service.withApprovedDatabase(headers(recoveryCookie), async () => 1));
        assert.equal((await request("complete-profile", profile, recoveryCookie)).status, 200);
        assert.equal(
          (await (await request("account", undefined, recoveryCookie)).json()).status,
          "pending",
        );
      },
    );
    await t.test(
      "resend throttles repeated sends and concurrent registration cannot duplicate identity",
      async () => {
        const address = `${prefix}-concurrent@example.invalid`;
        const results = await Promise.all([signup(address), signup(address)]);
        assert.ok(results.every((r) => [200, 400].includes(r.status)));
        assert.equal(
          (await owner.client`select * from auth.users where email=${address}`).length,
          1,
        );
        await request("send-verification-email", { email: address });
        const count = provider.messages.length;
        await request("send-verification-email", { email: address });
        assert.equal(provider.messages.length, count);
      },
    );
  } finally {
    try {
      await owner.client.begin(async (tx) => {
        const users = await tx`select id from auth.users where email like ${prefix + "%"}`;
        const ids = users.map((r) => r["id"] as string);
        for (const table of ["audit_events", "account_approval_events", "popia_consent_events"])
          await tx.unsafe(`alter table app.${table} disable trigger user`);
        await tx`delete from app.audit_events where actor_id=any(${ids})`;
        await tx`delete from app.account_approval_events where user_id=any(${ids})`;
        await tx`delete from app.popia_consent_events where user_id=any(${ids})`;
        await tx`delete from app.approval_notifications where user_id=any(${ids})`;
        await tx`delete from app.role_assignments where user_id=any(${ids})`;
        await tx`delete from app.clergy_profiles where user_id=any(${ids})`;
        await tx`delete from auth.users where id=any(${ids})`;
        // All email-once digests in this suite are derived from captured local messages.
        for (const message of provider.messages) {
          const url = new URL(message.text.match(/https?:\/\/[^\s]+/)![0]);
          const token = url.searchParams.get("token");
          if (token)
            await tx`delete from auth.verifications where id=${createHash("sha256").update(token).digest("hex")}`;
        }
        await tx`delete from auth.verifications where identifier like ${"reset-password:%"} and value=any(${ids})`;
        for (const table of ["audit_events", "account_approval_events", "popia_consent_events"])
          await tx.unsafe(`alter table app.${table} enable trigger user`);
      });
    } finally {
      globalThis.fetch = originalFetch;
      await runtime.close();
      await owner.close();
    }
  }
});
