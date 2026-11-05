import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Resend } from "resend";
import { emailTemplate, type EmailKind } from "./templates.server.ts";

export type EmailMessage = {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  key: string;
};
export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}
export class TestEmailProvider implements EmailProvider {
  readonly messages: EmailMessage[] = [];
  fail = false;
  async send(message: EmailMessage) {
    if (this.fail) throw new Error("EMAIL_DELIVERY_FAILED");
    this.messages.push(message);
  }
}
export class DevelopmentEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    // Captured secrets never go to logs or a public HTTP endpoint.
    const directory = ".local/email";
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(`${directory}/${randomUUID()}.json`, JSON.stringify(message, null, 2), {
      mode: 0o600,
    });
  }
}
export class ResendEmailProvider implements EmailProvider {
  private readonly client: Resend;
  constructor(client: Resend) {
    this.client = client;
  }
  async send(message: EmailMessage) {
    const { key, ...payload } = message;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.client.emails.send(payload, { idempotencyKey: key });
        if (!result.error && result.data?.id) return;
        if (
          result.error &&
          result.error.name !== "rate_limit_exceeded" &&
          result.error.name !== "application_error"
        )
          break;
      } catch {
        /* Retry transport failure using exactly the same payload and key. */
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
    }
    throw new Error("EMAIL_DELIVERY_FAILED");
  }
}
export class EmailService {
  readonly provider: EmailProvider;
  private readonly config: { from: string; origin: string; replyTo?: string };
  constructor(provider: EmailProvider, config: { from: string; origin: string; replyTo?: string }) {
    this.provider = provider;
    this.config = config;
  }
  async send(kind: EmailKind, to: string, url: string) {
    if (new URL(url).origin !== this.config.origin) throw new Error("Untrusted email URL");
    const message = {
      ...emailTemplate(kind, url),
      to,
      from: this.config.from,
      ...(this.config.replyTo ? { replyTo: this.config.replyTo } : {}),
      key: createHash("sha256").update(`${kind}:${to}:${url}`).digest("hex"),
    };
    try {
      await this.provider.send(message);
    } catch {
      console.error("email.delivery_failed", { kind });
      throw new Error("EMAIL_DELIVERY_FAILED");
    }
  }
}
export function configuredEmail(origin: string, env = process.env) {
  const real = env["EMAIL_PROVIDER"] === "resend";
  if (
    env["NODE_ENV"] === "production" &&
    !real &&
    !(
      env["CAPE_LOCAL_EMAIL_CAPTURE"] === "true" &&
      ["localhost", "127.0.0.1"].includes(new URL(origin).hostname)
    )
  )
    throw new Error("Production email must be explicitly configured");
  if (
    real &&
    (!env["RESEND_API_KEY"] || !env["EMAIL_FROM"] || env["EMAIL_DOMAIN_VERIFIED"] !== "true")
  )
    throw new Error("Resend requires credentials and a verified sender domain");
  return new EmailService(
    real
      ? new ResendEmailProvider(new Resend(env["RESEND_API_KEY"]))
      : new DevelopmentEmailProvider(),
    {
      from: env["EMAIL_FROM"] || "Local testing <local@example.invalid>",
      origin,
      ...(env["EMAIL_REPLY_TO"] ? { replyTo: env["EMAIL_REPLY_TO"] } : {}),
    },
  );
}
