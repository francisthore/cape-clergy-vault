import { sql } from "drizzle-orm";
import { boolean, check, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { app, createdAt } from "./common.ts";
import { profiles } from "./profiles.ts";
export const operationalGrants = app
  .table(
    "operational_grants",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: text("user_id")
        .notNull()
        .references(() => profiles.userId),
      capability: text("capability").notNull(),
      delegated: text("delegated")
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
      createdAt: createdAt(),
      revokedAt: timestamp("revoked_at", { withTimezone: true }),
    },
    (t) => [
      check(
        "operational_capability",
        sql`${t.capability} in ('review_coordinator','access_manager')`,
      ),
      check(
        "operational_delegation",
        sql`${t.delegated} <@ array['approver','review_coordinator','reviewer','settings_manager']::text[] and (${t.capability}='access_manager' or cardinality(${t.delegated})=0)`,
      ),
      uniqueIndex("operational_active_unique")
        .on(t.userId, t.capability)
        .where(sql`${t.revokedAt} is null`),
    ],
  )
  .enableRLS();
export const administrationEvents = app
  .table("administration_events", {
    id: uuid("id").primaryKey(),
    actorId: text("actor_id"),
    operator: text("operator"),
    targetId: text("target_id").notNull(),
    action: text("action").notNull(),
    capability: text("capability").notNull(),
    reason: text("reason").notNull(),
    resultId: uuid("result_id"),
    createdAt: createdAt(),
  })
  .enableRLS();
export const administrationBootstrap = app
  .table(
    "administration_bootstrap",
    {
      singleton: boolean("singleton").primaryKey().default(true),
      userId: text("user_id")
        .notNull()
        .references(() => profiles.userId),
      createdAt: createdAt(),
    },
    (t) => [check("administration_singleton", sql`${t.singleton}`)],
  )
  .enableRLS();
