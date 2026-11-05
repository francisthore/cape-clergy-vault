import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { authOptions } from "./options.server.ts";

// Lazy client with an unusable endpoint: schema generation never connects.
// Deliberately ignores every environment database URL.
const db = drizzle(postgres("postgresql://offline:offline@127.0.0.1:1/offline"));
export const auth = betterAuth({
  ...authOptions,
  advanced: { database: { validateSchema: false } }, // Offline generator has no table metadata.
  baseURL: "http://localhost:3000",
  database: drizzleAdapter(db, { provider: "pg", schemaName: "auth" }),
});
