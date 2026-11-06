import {
  clientAddress,
  consumeLimit,
  limitedResponse,
  type LimitPurpose,
} from "../security/rate-limit.server.ts";
import { createHash } from "node:crypto";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { createLocalAuth } from "../../../database/auth/config.server.ts";
import { createRequestDatabaseBoundary } from "../../../database/context.server.ts";
import type { RuntimeConnection } from "../../../database/runtime.server.ts";
import { EmailService } from "../email/service.server.ts";
import { emailSchema, passwordSchema, profileSchema, registrationSchema } from "./registration.ts";

const genericMail = {
  message:
    "If this address is eligible, an email will arrive. Check your inbox or try again later.",
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function createAuthService(
  connection: RuntimeConnection,
  email: EmailService,
  config: { secret: string; baseURL: string },
) {
  async function limit(request: Request, purpose: LimitPurpose, subject?: string) {
    const result = await consumeLimit(
      connection.client,
      config.secret,
      purpose,
      subject ?? clientAddress(request),
    );
    return result.allowed ? null : limitedResponse(result.retryAfter);
  }
  async function limitOperation(request: Request, purpose: LimitPurpose) {
    const denied = await limit(request, purpose);
    if (denied) return denied;
    const session = await auth.api.getSession({
      headers: request.headers,
      query: { disableCookieCache: true },
    });
    return session?.user.emailVerified
      ? limit(request, purpose, `identity:${session.user.id}`)
      : null;
  }
  const internalBoundary = (id: string) =>
    createRequestDatabaseBoundary(connection, async () => ({ user: { id } }));
  const auth = createLocalAuth(connection, {
    ...config,
    sendOnSignUp: false,
    sendVerificationEmail: async ({ user, url, token }) => {
      // Store only a digest of Better Auth's JWT. Never invent password/verification tokens.
      const digest = hash(token);
      await connection.client`insert into auth.verifications(id,identifier,value,expires_at)
        values (${digest},${"email-once:" + digest},${digest},now()+interval '1 hour') on conflict (id) do nothing`;
      const trusted = new URL(url);
      trusted.searchParams.set("callbackURL", `${config.baseURL}/auth?view=verified`);
      await email.send("verification", user.email, trusted.href);
    },
    sendResetPassword: async ({ user, url }) => {
      await email.send("reset", user.email, url);
    },
    // Registration-received intent is queued transactionally by database triggers.
  });
  const withRequestDatabase = createRequestDatabaseBoundary(connection, async (headers) => {
    const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    return session?.user.emailVerified ? session : null;
  });
  async function provision(id: string, data: z.infer<typeof profileSchema>) {
    await internalBoundary(id)(new Headers(), async (tx) => {
      await tx`select app.provision_clergy(${id},${data.fullName},${data.title},${data.parish},${data.phone},${data.acknowledged},${data.noticeVersion})`;
    });
  }
  async function account(headers: Headers) {
    const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    if (!session?.user.emailVerified) return { status: "signed-out" };
    return withRequestDatabase(headers, async (tx) => {
      const [profile] =
        await tx`select approval_status from app.clergy_profiles where user_id=${session.user.id}`;
      const status = String(profile?.["approval_status"] ?? "incomplete");
      if (status === "suspended")
        await tx`delete from auth.sessions where user_id=${session.user.id}`;
      const [permission] =
        await tx`select app.is_approver() as allowed, app.is_settings_manager() as settings, app.is_reviewer() as reviewer`;
      return {
        status,
        canApprove: permission?.["allowed"] === true,
        canManageSettings: permission?.["settings"] === true,
        canReview: permission?.["reviewer"] === true,
      };
    });
  }
  // Future protected operations must use this gate AND scoped tx/RLS, never a UI redirect.
  async function withApprovedDatabase<T>(
    headers: Headers,
    operation: Parameters<typeof withRequestDatabase<T>>[1],
  ) {
    return withRequestDatabase(headers, async (tx) => {
      const [row] = await tx`select app.is_active() as approved`;
      if (!row?.["approved"]) throw new Error("Approved account required");
      return operation(tx);
    });
  }
  const json = (body: unknown, status = 200, headers?: Headers) => {
    const h = new Headers(headers);
    h.delete("Content-Length");
    h.set("Cache-Control", "no-store");
    h.set("Referrer-Policy", "no-referrer");
    return Response.json(body, { status, headers: h });
  };
  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/auth/, "");
    if (request.method !== "GET" && request.method !== "POST") return json({}, 405);
    // All mutations require an exact trusted Origin, including custom endpoints.
    if (request.method === "POST" && request.headers.get("origin") !== config.baseURL)
      return json({ message: "Untrusted origin" }, 403);
    try {
      const denied = await limit(request, "auth");
      if (denied) return denied;
      if (path === "/account" && request.method === "GET")
        return json(await account(request.headers));
      if (path === "/verify-email" && request.method === "GET") {
        if ([...url.searchParams.keys()].some((key) => !["token", "callbackURL"].includes(key)))
          return json({}, 400);
        if (url.searchParams.get("callbackURL") !== `${config.baseURL}/auth?view=verified`)
          return json({ message: "Invalid callback" }, 400);
        const digest = hash(url.searchParams.get("token") ?? "");
        const consumed =
          await connection.client`delete from auth.verifications where identifier=${"email-once:" + digest} and value=${digest} and expires_at>now() returning id`;
        if (!consumed.length)
          return Response.redirect(`${config.baseURL}/auth?view=verified&error=invalid`, 302);
        const response = await auth.handler(request);
        const h = new Headers(response.headers);
        h.set("Cache-Control", "no-store");
        h.set("Referrer-Policy", "no-referrer");
        return new Response(response.body, { status: response.status, headers: h });
      }
      if (path.startsWith("/reset-password/") && request.method === "GET") {
        if (url.searchParams.get("callbackURL") !== `${config.baseURL}/auth?view=reset`)
          return json({}, 400);
        return auth.handler(request);
      }
      if (request.method !== "POST") return json({}, 404);
      if (Number(request.headers.get("content-length")) > 16_384) return json({}, 413);
      const raw = await request.text();
      if (raw.length > 16_384) return json({}, 413);
      const input: unknown = JSON.parse(raw);
      if (path === "/register") {
        const data = registrationSchema.parse(input);
        const denied = await limit(request, "register");
        if (denied) return denied;
        const result = await auth.api.signUpEmail({
          body: { name: data.fullName, email: data.email, password: data.password },
        });
        // Duplicate signup returns a synthetic identity. Do not match on email or
        // provision/overwrite an existing account from unauthenticated input.
        const [identity] =
          await connection.client`select id from auth.users where id=${result.user.id} and email=${data.email}`;
        if (identity) {
          let failed = false;
          try {
            await provision(
              result.user.id,
              profileSchema.parse({
                title: data.title,
                fullName: data.fullName,
                parish: data.parish,
                phone: data.phone,
                acknowledged: data.acknowledged,
                noticeVersion: data.noticeVersion,
              }),
            );
          } catch {
            failed = true;
            console.error("auth.provisioning_failed");
          }
          await auth.api.sendVerificationEmail({
            body: { email: data.email, callbackURL: `${config.baseURL}/auth?view=verified` },
          });
          if (failed)
            return json(
              {
                message:
                  "Registration needs recovery. Verify your email, then sign in and complete your profile.",
              },
              503,
            );
        }
        return json(genericMail);
      }
      if (path === "/complete-profile") {
        const data = profileSchema.parse(input);
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user.emailVerified) return json({ message: "Sign in again" }, 401);
        await provision(session.user.id, data);
        return json(await account(request.headers));
      }
      const publicEmail = z.object({ email: emailSchema }).strict();
      if (path === "/send-verification-email" || path === "/request-password-reset") {
        const { email: address } = publicEmail.parse(input);
        const denied = await limit(request, "mail", `${path}:${address}`);
        if (denied) return denied;
        try {
          if (path === "/send-verification-email")
            await auth.api.sendVerificationEmail({
              body: { email: address, callbackURL: `${config.baseURL}/auth?view=verified` },
            });
          else
            await auth.api.requestPasswordReset({
              body: { email: address, redirectTo: `${config.baseURL}/auth?view=reset` },
            });
        } catch {
          console.error("auth.email_request_failed", { operation: path });
        }
        // Same public response on missing/verified accounts and delivery failure.
        return json(genericMail);
      }
      if (path === "/sign-in/email") {
        const data = z
          .object({ email: emailSchema, password: z.string().min(1).max(128) })
          .strict()
          .parse(input);
        const denied = await limit(request, "login");
        if (denied) return denied;
        const mailboxDenied = await limit(request, "login", `mailbox:${data.email}`);
        if (mailboxDenied) return mailboxDenied;
        const response = await auth.api.signInEmail({
          body: data,
          headers: request.headers,
          asResponse: true,
        });
        if (!response.ok)
          return json(
            { message: "Sign-in failed. Check your details or request email verification." },
            401,
          );
        const cookie = response.headers
          .getSetCookie()
          .map((v) => v.split(";")[0])
          .join("; ");
        const state = await account(new Headers({ cookie }));
        if (state.status === "suspended" || state.status === "signed-out")
          return json({ message: "Sign-in failed. Check your details or account status." }, 401);
        // Preserve Set-Cookie; never return session credentials in JSON.
        return json({ ok: true }, 200, response.headers);
      }
      if (path === "/sign-out") {
        const response = await auth.api.signOut({ headers: request.headers, asResponse: true });
        return json({ ok: response.ok }, response.status, response.headers);
      }
      if (path === "/reset-password") {
        const data = z
          .object({ token: z.string().min(1).max(512), newPassword: passwordSchema })
          .strict()
          .parse(input);
        const denied = await limit(request, "reset");
        if (denied) return denied;
        await auth.api.resetPassword({ body: data });
        return json({ ok: true });
      }
      return json({}, 404); // No alternate signup, update-user, delete-user or session-token API.
    } catch (error) {
      if (path === "/verify-email") {
        console.error("auth.verification_feedback_failed");
        return Response.redirect(`${config.baseURL}/auth?view=verified&error=recovery`, 302);
      }
      if (error instanceof z.ZodError)
        return json({ message: error.issues[0]?.message ?? "Invalid input" }, 400);
      if (error instanceof SyntaxError) return json({ message: "Invalid request" }, 400);
      if (error instanceof APIError)
        return json(
          {
            message: "Request could not be completed. Check your details, token or account status.",
          },
          error.statusCode >= 500 ? 503 : 400,
        );
      console.error("auth.request_failed", { operation: path });
      return json(
        { message: "Unable to complete this request. Try again or use account recovery." },
        503,
      );
    }
  }
  // Denial auditing/recovery must also work for anonymous or newly inactive users.
  // Only fixed-purpose document audit/recovery functions use this boundary.
  async function withAuditDatabase<T>(
    headers: Headers,
    operation: (tx: import("postgres").TransactionSql) => Promise<T>,
  ): Promise<T> {
    const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    return (await connection.client.begin(async (tx) => {
      await tx`select set_config('cape.user_id', ${session?.user.id ?? ""}, true)`;
      return operation(tx);
    })) as T;
  }
  return { auth, handle, account, withApprovedDatabase, withAuditDatabase, limitOperation };
}
