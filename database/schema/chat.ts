import { sql } from "drizzle-orm";
import { boolean, check, index, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { app, createdAt } from "./common.ts";
import { profiles } from "./profiles.ts";

export const chatMessages = app
  .table(
    "chat_messages",
    {
      // Client-assigned UUID preserves offline outbox idempotency.
      id: uuid("id").primaryKey(),
      ownerId: text("owner_id")
        .notNull()
        .references(() => profiles.userId),
      senderId: text("sender_id")
        .notNull()
        .references(() => profiles.userId),
      body: text("body").notNull(),
      createdAt: createdAt(),
    },
    (t) => [
      check("chat_body_length", sql`char_length(btrim(${t.body})) between 1 and 4000`),
      index("chat_owner_created_idx").on(t.ownerId, t.createdAt, t.id),
    ],
  )
  .enableRLS();

export const chatNotificationPreferences = app
  .table(
    "chat_notification_preferences",
    {
      userId: text("user_id")
        .notNull()
        .references(() => profiles.userId),
      ownerId: text("owner_id")
        .notNull()
        .references(() => profiles.userId),
      muted: boolean("muted").notNull().default(false),
    },
    (t) => [primaryKey({ columns: [t.userId, t.ownerId] })],
  )
  .enableRLS();

export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
