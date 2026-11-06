import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { RuntimeConnection } from "../runtime.server.ts";
import * as schema from "./generated.ts";
import { authOptions } from "./options.server.ts";

// Factory only: no singleton, public handler, Google provider or startup connection.
// The mail transport must be explicitly supplied; no fake successful verification.
export function createLocalAuth(
  connection: RuntimeConnection,
  options: {
    secret: string;
    baseURL: string;
    sendOnSignUp?: boolean;
    sendResetPassword?: (data: {
      user: { email: string };
      url: string;
      token: string;
    }) => Promise<void>;
    afterEmailVerification?: (user: { id: string; email: string }) => Promise<void>;
    sendVerificationEmail: (data: {
      user: { email: string };
      url: string;
      token: string;
    }) => Promise<void>;
  },
) {
  if (options.secret.length < 32) throw new Error("Auth secret must have at least 32 characters");
  const origin = new URL(options.baseURL);
  if (
    origin.origin !== options.baseURL ||
    (origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)))
  ) {
    throw new Error("Use an explicit trusted HTTPS origin or local development origin");
  }
  return betterAuth({
    ...authOptions,
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: [options.baseURL],
    advanced: {
      useSecureCookies: origin.protocol === "https:",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: origin.protocol === "https:",
      },
    },
    logger: { disabled: true }, // Do not let library errors include emails, SQL or credentials.
    // The allowlisted public handler uses the shared PostgreSQL limiter.
    // Server-side Better Auth API calls do not provide an independent public route.
    rateLimit: { enabled: false },
    database: drizzleAdapter(connection.db, {
      provider: "pg",
      schemaName: "auth",
      schema,
      transaction: true,
    }),
    emailAndPassword: {
      ...authOptions.emailAndPassword,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      ...(options.sendResetPassword ? { sendResetPassword: options.sendResetPassword } : {}),
    },
    emailVerification: {
      sendOnSignUp: options.sendOnSignUp ?? true,
      sendOnSignIn: false,
      expiresIn: 3600,
      autoSignInAfterVerification: false,
      sendVerificationEmail: options.sendVerificationEmail,
      ...(options.afterEmailVerification
        ? { afterEmailVerification: options.afterEmailVerification }
        : {}),
    },
  });
}
