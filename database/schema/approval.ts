import { boolean, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { app, createdAt } from "./common.ts";

// Internal operational rows: no runtime table access; guarded worker functions only.
export const approvalNotifications = app
  .table("approval_notifications", {
    id: uuid("id").primaryKey().defaultRandom(),
    eventKey: text("event_key").notNull().unique(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    createdAt: createdAt(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseToken: uuid("lease_token"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
  })
  .enableRLS();
export const approverBootstrap = app
  .table("approver_bootstrap", {
    singleton: boolean("singleton").primaryKey().default(true),
    userId: text("user_id").notNull(),
    createdAt: createdAt(),
  })
  .enableRLS();
