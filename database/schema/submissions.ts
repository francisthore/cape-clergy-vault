import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, text, unique, uuid } from "drizzle-orm/pg-core";
import { app, createdAt } from "./common.ts";
import { profiles } from "./profiles.ts";

export const submissionKind = app.enum("submission_kind", ["document", "idea"]);
export const submissionStatus = app.enum("submission_status", [
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
      createdAt: createdAt(),
    },
    (t) => [index("review_submission_created_idx").on(t.submissionId, t.createdAt)],
  )
  .enableRLS();

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type ReviewDecision = typeof reviewDecisions.$inferSelect;
