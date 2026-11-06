import { index, integer, text, timestamp } from "drizzle-orm/pg-core";
import { app } from "./common.ts";
export const rateLimits = app
  .table(
    "rate_limits",
    {
      key: text("key").primaryKey(),
      hits: integer("hits").notNull(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    },
    (t) => [index("rate_limits_expiry_idx").on(t.expiresAt)],
  )
  .enableRLS();
