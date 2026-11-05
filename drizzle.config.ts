import { defineConfig } from "drizzle-kit";

// Offline generation only. db:migrate enforces local isolation before connecting.
// Historical Supabase SQL in drizzle/migrations is deliberately excluded.
export default defineConfig({
  dialect: "postgresql",
  schema: "./database/schema/index.ts",
  out: "./database/migrations",
  schemaFilter: ["app"],
  strict: true,
  verbose: true,
});
