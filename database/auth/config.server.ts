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
    sendVerificationEmail: (data: {
      user: { email: string };
      url: string;
      token: string;
    }) => Promise<void>;
  },
) {
  if (options.secret.length < 32) throw new Error("Auth secret must have at least 32 characters");
  return betterAuth({
    ...authOptions,
    secret: options.secret,
    baseURL: options.baseURL,
    database: drizzleAdapter(connection.db, { provider: "pg", schemaName: "auth", schema }),
    emailVerification: { sendOnSignUp: true, sendVerificationEmail: options.sendVerificationEmail },
  });
}
