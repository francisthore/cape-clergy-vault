import { sql } from "drizzle-orm";
import { boolean, check, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { app, createdAt } from "./common.ts";
import { profiles } from "./profiles.ts";

// A separate capability never participates in reviewer or approver checks.
export const settingsManagers = app
  .table("settings_managers", {
    userId: text("user_id")
      .primaryKey()
      .references(() => profiles.userId),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  })
  .enableRLS();
export const emailDomains = app
  .table("email_domains", {
    domain: text("domain").primaryKey(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
  })
  .enableRLS();
export const emailSettings = app
  .table(
    "email_settings",
    {
      id: integer("id").primaryKey().default(1),
      sendingDomain: text("sending_domain").notNull().default("notifications.ctdiocese.org.za"),
      displayName: text("display_name").notNull().default("Cape Clergy Vault"),
      fromEmail: text("from_email")
        .notNull()
        .default("notifications@notifications.ctdiocese.org.za"),
      replyTo: text("reply_to").notNull().default(""),
      transactionalEnabled: boolean("transactional_enabled").notNull().default(true),
      notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
      version: integer("version").notNull().default(1),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
      updatedBy: text("updated_by").references(() => profiles.userId),
    },
    (t) => [
      check("email_settings_singleton", sql`${t.id}=1`),
      check("email_version_positive", sql`${t.version}>0`),
    ],
  )
  .enableRLS();
export const emailSettingsHistory = app
  .table("email_settings_history", {
    id: uuid("id").primaryKey().defaultRandom(),
    version: integer("version").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => profiles.userId),
    sendingDomain: text("sending_domain").notNull(),
    displayName: text("display_name").notNull(),
    fromEmail: text("from_email").notNull(),
    replyTo: text("reply_to").notNull(),
    transactionalEnabled: boolean("transactional_enabled").notNull(),
    notificationsEnabled: boolean("notifications_enabled").notNull(),
    createdAt: createdAt(),
  })
  .enableRLS();
export const emailTestAttempts = app
  .table("email_test_attempts", {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id")
      .notNull()
      .references(() => profiles.userId),
    createdAt: createdAt(),
  })
  .enableRLS();
