import { sql } from "drizzle-orm";
import { check, index, integer, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, createdAt } from "./common.ts";
import { profiles } from "./profiles.ts";
import { reviewerAssignments, submissions } from "./submissions.ts";
export const reviewerInvitations = app
  .table(
    "reviewer_invitations",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: text("user_id")
        .notNull()
        .references(() => profiles.userId),
      mailbox: text("mailbox").notNull(),
      tokenDigest: text("token_digest").notNull().unique(),
      issuedBy: text("issued_by").notNull(),
      createdAt: createdAt(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      state: text("state").notNull().default("pending"),
      acceptedAt: timestamp("accepted_at", { withTimezone: true }),
      revokedAt: timestamp("revoked_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("reviewer_invitation_pending_unique")
        .on(t.userId)
        .where(sql`${t.state}='pending'`),
      check("reviewer_invitation_digest", sql`${t.tokenDigest} ~ '^[0-9a-f]{64}$'`),
      check(
        "reviewer_invitation_expiry",
        sql`${t.expiresAt}>${t.createdAt} and ${t.expiresAt}<=${t.createdAt}+interval '1 hour'`,
      ),
      check(
        "reviewer_invitation_state",
        sql`(${t.state}='pending' and ${t.acceptedAt} is null and ${t.revokedAt} is null) or (${t.state}='accepted' and ${t.acceptedAt} is not null and ${t.revokedAt} is null) or (${t.state}='revoked' and ${t.revokedAt} is not null and ${t.acceptedAt} is null)`,
      ),
    ],
  )
  .enableRLS();
export const reviewerEvents = app
  .table(
    "reviewer_events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      invitationId: uuid("invitation_id").references(() => reviewerInvitations.id),
      assignmentId: uuid("assignment_id").references(() => reviewerAssignments.id),
      reviewerId: text("reviewer_id")
        .notNull()
        .references(() => profiles.userId),
      actorId: text("actor_id").references(() => profiles.userId),
      operator: text("operator"),
      action: text("action").notNull(),
      correlationId: uuid("correlation_id").notNull().defaultRandom(),
      createdAt: createdAt(),
    },
    (t) => [index("reviewer_event_identity_idx").on(t.reviewerId, t.createdAt)],
  )
  .enableRLS();
// Separate domain outbox; encrypted proof only, never plaintext token storage.
export const reviewerNotifications = app
  .table(
    "reviewer_notifications",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      eventKey: text("event_key").notNull().unique(),
      userId: text("user_id")
        .notNull()
        .references(() => profiles.userId),
      kind: text("kind").notNull(),
      invitationId: uuid("invitation_id").references(() => reviewerInvitations.id),
      submissionId: uuid("submission_id").references(() => submissions.id),
      assignmentId: uuid("assignment_id").references(() => reviewerAssignments.id),
      sealedToken: text("sealed_token"),
      createdAt: createdAt(),
      attempts: integer("attempts").notNull().default(0),
      availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
      leaseToken: uuid("lease_token"),
      deliveredAt: timestamp("delivered_at", { withTimezone: true }),
      cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
      lastError: text("last_error"),
      senderFrom: text("sender_from"),
      senderReplyTo: text("sender_reply_to"),
      recipientEmail: text("recipient_email"),
    },
    (t) => [
      index("reviewer_notifications_pending_idx").on(t.availableAt, t.createdAt),
      check(
        "reviewer_notification_kind",
        sql`${t.kind} in ('reviewer_invitation','review_assigned','submission_accepted','submission_returned')`,
      ),
      check(
        "reviewer_notification_proof",
        sql`(${t.kind}='reviewer_invitation' and ${t.invitationId} is not null) or (${t.kind}<>'reviewer_invitation' and ${t.submissionId} is not null and ${t.sealedToken} is null)`,
      ),
    ],
  )
  .enableRLS();
