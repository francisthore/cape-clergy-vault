import { bigint, check, index, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { app, createdAt } from "./common.ts";
import { profiles } from "./profiles.ts";

export const consentAction = app.enum("consent_action", ["accepted", "withdrawn"]);
export const consentPurpose = app.enum("consent_purpose", ["repository", "private_chat"]);
export const popiaConsentEvents = app
  .table(
    "popia_consent_events",
    {
      id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
      userId: text("user_id")
        .notNull()
        .references(() => profiles.userId),
      noticeVersion: text("notice_version").notNull(),
      purpose: consentPurpose("purpose").notNull(),
      action: consentAction("action").notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      index("consent_user_purpose_created_idx").on(t.userId, t.purpose, t.createdAt, t.id),
      check("consent_version_nonempty", sql`length(btrim(${t.noticeVersion})) > 0`),
    ],
  )
  .enableRLS();

export type PopiaConsentEvent = typeof popiaConsentEvents.$inferSelect;
