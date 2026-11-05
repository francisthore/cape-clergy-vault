import { sql } from "drizzle-orm";
import { check, index, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { app, createdAt } from "./common.ts";

export const approvalStatus = app.enum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "suspended",
]);
export const appRole = app.enum("app_role", ["clergy", "admin"]);

export const profiles = app
  .table(
    "clergy_profiles",
    {
      // Opaque Better Auth string ID; FK to its generated user table is deferred.
      userId: text("user_id").primaryKey(),
      fullName: text("full_name").notNull(),
      title: text("title").notNull().default(""),
      parish: text("parish").notNull().default(""),
      phone: text("phone").notNull().default(""),
      approvalStatus: approvalStatus("approval_status").notNull().default("pending"),
      createdAt: createdAt(),
    },
    (t) => [check("profile_user_id_nonempty", sql`length(btrim(${t.userId})) > 0`)],
  )
  .enableRLS();

export const accountApprovalEvents = app
  .table(
    "account_approval_events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: text("user_id")
        .notNull()
        .references(() => profiles.userId),
      actorId: text("actor_id")
        .notNull()
        .references(() => profiles.userId),
      status: approvalStatus("status").notNull(),
      reason: text("reason").notNull().default(""),
      createdAt: createdAt(),
    },
    (t) => [index("approval_user_created_idx").on(t.userId, t.createdAt)],
  )
  .enableRLS();

export const roleAssignments = app
  .table(
    "role_assignments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: text("user_id")
        .notNull()
        .references(() => profiles.userId),
      role: appRole("role").notNull(),
      grantedBy: text("granted_by").references(() => profiles.userId),
      createdAt: createdAt(),
      revokedAt: timestamp("revoked_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("role_active_unique")
        .on(t.userId, t.role)
        .where(sql`${t.revokedAt} is null`),
      check(
        "role_revoked_after_grant",
        sql`${t.revokedAt} is null or ${t.revokedAt} >= ${t.createdAt}`,
      ),
    ],
  )
  .enableRLS();

export type ClergyProfile = typeof profiles.$inferSelect;
export type NewClergyProfile = typeof profiles.$inferInsert;
export type RoleAssignment = typeof roleAssignments.$inferSelect;
