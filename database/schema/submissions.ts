import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  timestamp,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { app, createdAt } from "./common.ts";
import { profiles } from "./profiles.ts";

export const submissionKind = app.enum("submission_kind", ["document", "idea"]);
export const submissionStatus = app.enum("submission_status", [
  "draft",
  "submitted",
  "under_review",
  "accepted",
  "returned",
]);
export const reviewOutcome = app.enum("review_outcome", ["under_review", "accepted", "returned"]);

export const submissions = app
  .table(
    "submissions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      ownerId: text("owner_id")
        .notNull()
        .references(() => profiles.userId),
      kind: submissionKind("kind").notNull().default("document"),
      title: text("title").notNull(),
      category: text("category").notNull().default("General"),
      abstract: text("abstract").notNull().default(""),
      keywords: text("keywords")
        .array()
        .notNull()
        .default(sql`'{}'::text[]`),
      confidential: boolean("confidential").notNull().default(false),
      status: submissionStatus("status").notNull().default("submitted"),
      version: integer("version").notNull().default(1),
      revision: integer("revision").notNull().default(1),
      submittedAt: timestamp("submitted_at", { withTimezone: true }),
      createdAt: createdAt(),
    },
    (t) => [
      index("submission_owner_created_idx").on(t.ownerId, t.createdAt),
      index("submission_status_idx").on(t.status),
      check("submission_title_nonempty", sql`length(btrim(${t.title})) > 0`),
    ],
  )
  .enableRLS();

export const documents = app
  .table(
    "documents",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      submissionId: uuid("submission_id")
        .notNull()
        .references(() => submissions.id),
      storageKey: text("storage_key").notNull(),
      fileName: text("file_name").notNull(),
      mediaType: text("media_type").notNull(),
      byteSize: bigint("byte_size", { mode: "bigint" }).notNull(),
      sha256: text("sha256"),
      excluded: boolean("excluded").notNull().default(false),
      state: text("state").notNull().default("pending"),
      uploadRequestId: uuid("upload_request_id").notNull().defaultRandom(),
      createdAt: createdAt(),
    },
    (t) => [
      unique("document_storage_key_unique").on(t.storageKey),
      unique("document_upload_request_unique").on(t.submissionId, t.uploadRequestId),
      index("document_submission_idx").on(t.submissionId),
      check("document_size_nonnegative", sql`${t.byteSize} >= 0`),
      check("document_sha256_format", sql`${t.sha256} is null or ${t.sha256} ~ '^[0-9a-f]{64}$'`),
      check("document_state_valid", sql`${t.state} in ('pending', 'available', 'failed')`),
      check(
        "document_available_complete",
        sql`${t.state} <> 'available' or (${t.byteSize} > 0 and ${t.sha256} is not null)`,
      ),
    ],
  )
  .enableRLS();

// Explicit current-revision authorization; no global role substitutes for an assignment.
export const reviewerAssignments = app
  .table(
    "reviewer_assignments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      submissionId: uuid("submission_id")
        .notNull()
        .references(() => submissions.id),
      revision: integer("revision").notNull(),
      reviewerId: text("reviewer_id")
        .notNull()
        .references(() => profiles.userId),
      assignedBy: text("assigned_by").notNull(),
      createdAt: createdAt(),
      status: text("status").notNull().default("active"),
      revokedAt: timestamp("revoked_at", { withTimezone: true }),
      correlationId: uuid("correlation_id").notNull().defaultRandom(),
    },
    (t) => [
      uniqueIndex("reviewer_assignment_active_unique")
        .on(t.submissionId, t.revision, t.reviewerId)
        .where(sql`${t.status}='active'`),
      index("reviewer_assignment_inbox_idx").on(t.reviewerId, t.submissionId, t.revision),
      check("reviewer_assignment_revision_positive", sql`${t.revision}>0`),
      check(
        "reviewer_assignment_state",
        sql`(${t.status}='active' and ${t.revokedAt} is null) or (${t.status}='revoked' and ${t.revokedAt} is not null and ${t.revokedAt}>=${t.createdAt})`,
      ),
    ],
  )
  .enableRLS();

export const reviewDecisions = app
  .table(
    "review_decisions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      submissionId: uuid("submission_id")
        .notNull()
        .references(() => submissions.id),
      reviewerId: text("reviewer_id")
        .notNull()
        .references(() => profiles.userId),
      outcome: reviewOutcome("outcome").notNull(),
      notes: text("notes").notNull().default(""),
      authorFeedback: text("author_feedback").notNull().default(""),
      revision: integer("revision"), // NULL denotes preserved pre-3E history.
      expectedVersion: integer("expected_version"),
      requestId: uuid("request_id").unique(),
      assignmentId: uuid("assignment_id").references(() => reviewerAssignments.id),
      createdAt: createdAt(),
    },
    (t) => [
      index("review_submission_created_idx").on(t.submissionId, t.createdAt),
      check(
        "review_decision_revision_fields",
        sql`(${t.revision} is null and ${t.expectedVersion} is null and ${t.assignmentId} is null and ${t.requestId} is null) or (${t.revision} is not null and ${t.revision}>0 and ${t.expectedVersion} is not null and ${t.expectedVersion}>0 and ${t.assignmentId} is not null and ${t.requestId} is not null)`,
      ),
    ],
  )
  .enableRLS();

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type ReviewDecision = typeof reviewDecisions.$inferSelect;

// Immutable author lifecycle snapshots; reviewer notes remain in their own table.
export const submissionEvents = app
  .table(
    "submission_events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      submissionId: uuid("submission_id")
        .notNull()
        .references(() => submissions.id),
      actorId: text("actor_id")
        .notNull()
        .references(() => profiles.userId),
      event: text("event").notNull(),
      version: integer("version").notNull(),
      revision: integer("revision").notNull(),
      title: text("title").notNull(),
      category: text("category").notNull(),
      abstract: text("abstract").notNull(),
      keywords: text("keywords").array().notNull(),
      confidential: boolean("confidential").notNull(),
      documentIds: uuid("document_ids").array().notNull(),
      createdAt: createdAt(),
    },
    (t) => [index("submission_event_parent_idx").on(t.submissionId, t.createdAt)],
  )
  .enableRLS();
