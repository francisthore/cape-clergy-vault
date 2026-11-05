import { z } from "zod";
import type { createAuthService } from "../auth/service.server.ts";
import type { EmailService } from "../email/service.server.ts";
import { emailSettingsSchema } from "./validation.ts";
import { failure, json, readInput, RequestError } from "../server/http.server.ts";
export function createSettingsService(
  auth: ReturnType<typeof createAuthService>,
  email: EmailService,
  origin: string,
  providerStatus: string,
) {
  const authorize = <T>(
    headers: Headers,
    work: Parameters<typeof auth.withApprovedDatabase<T>>[1],
  ) =>
    auth.withApprovedDatabase(headers, async (tx) => {
      await tx`select app.require_settings_manager()`;
      return work(tx);
    });
  async function handle(request: Request) {
    try {
      if (request.method === "GET")
        return json(
          await authorize(request.headers, async (tx) => {
            const [settings] = await tx`select * from app.email_settings where id=1`;
            const history =
              await tx`select version,actor_id,sending_domain,display_name,from_email,reply_to,transactional_enabled,notifications_enabled,created_at from app.email_settings_history order by version desc limit 30`;
            const domains =
              await tx`select domain,authorized_at from app.email_domains order by domain`;
            return { settings, history, domains, providerStatus };
          }),
        );
      if (request.method !== "POST") return json({}, 405);
      const input = await readInput(request, origin);
      const session = await auth.auth.api.getSession({
        headers: request.headers,
        query: { disableCookieCache: true },
      });
      const age = session ? Date.now() - new Date(session.session.createdAt).getTime() : NaN;
      if (!session?.user.emailVerified || !Number.isFinite(age) || age < 0 || age > 15 * 60_000)
        throw new RequestError(
          403,
          "Sign out and sign in again before changing settings or sending a test (15 minute limit).",
        );
      if (
        z
          .object({ action: z.literal("test") })
          .strict()
          .safeParse(input).success
      ) {
        const id = await authorize(request.headers, async (tx) => {
          const [row] = await tx`select app.reserve_email_test() as id`;
          return String(row!["id"]);
        });
        // Fresh permission check after reservation. No external provider call in a transaction.
        await authorize(request.headers, async () => true);
        await email.send("test", session.user.email, `${origin}/account`, `settings-test:${id}`);
        return json({
          message:
            providerStatus === "captured"
              ? "Test captured locally; no recipient delivery occurred."
              : "Provider accepted the test request. Recipient delivery is not confirmed.",
        });
      }
      const v = emailSettingsSchema.parse(input);
      await authorize(
        request.headers,
        async (tx) =>
          tx`select app.save_email_settings(${v.version},${v.sendingDomain},${v.displayName},${v.fromEmail},${v.replyTo},${v.transactionalEnabled},${v.notificationsEnabled})`,
      );
      return json({ message: "Email settings saved. Subsequent sends use these settings." });
    } catch (error) {
      return failure(error);
    }
  }
  return { authorize, handle };
}
