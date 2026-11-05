import { pgSchema, timestamp } from "drizzle-orm/pg-core";

export const app = pgSchema("app");
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
