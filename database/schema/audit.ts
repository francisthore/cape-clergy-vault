import { bigint, index, text, uuid } from "drizzle-orm/pg-core";
import { app, createdAt } from "./common.ts";

export const auditOutcome = app.enum("audit_outcome", ["ok", "denied", "error"]);
export const auditEvents = app
  .table(
    "audit_events",
    {
      id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
      createdAt: createdAt(),
      // No FKs: retain evidence through future account lifecycle changes.
      actorId: text("actor_id"),
      targetUserId: text("target_user_id"),
      submissionId: uuid("submission_id"),
      action: text("action").notNull(),
      outcome: auditOutcome("outcome").notNull(),
      correlationId: uuid("correlation_id"),
    },
    (t) => [
      index("audit_created_idx").on(t.createdAt),
      index("audit_actor_created_idx").on(t.actorId, t.createdAt),
    ],
  )
  .enableRLS();

export type AuditEvent = typeof auditEvents.$inferSelect;
