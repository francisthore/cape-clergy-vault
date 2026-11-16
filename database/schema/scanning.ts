import { sql } from "drizzle-orm";
import { bigint, check, index, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { app, createdAt } from "./common.ts";
import { documents } from "./submissions.ts";
export const documentScans = app
  .table(
    "document_scans",
    {
      documentId: uuid("document_id")
        .primaryKey()
        .references(() => documents.id),
      state: text("state").notNull().default("queued"),
      expectedSha256: text("expected_sha256").notNull(),
      scannedSha256: text("scanned_sha256"),
      attempts: integer("attempts").notNull().default(0),
      availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
      leaseToken: uuid("lease_token"),
      leaseUntil: timestamp("lease_until", { withTimezone: true }),
      startedAt: timestamp("started_at", { withTimezone: true }),
      completedAt: timestamp("completed_at", { withTimezone: true }),
      provider: text("provider").notNull().default("clamav"),
      externalScanId: text("external_scan_id"),
      expectedByteSize: bigint("expected_byte_size", { mode: "number" }),
      submissionRevision: integer("submission_revision"),
      submittedAt: timestamp("submitted_at", { withTimezone: true }),
      lastPollAt: timestamp("last_poll_at", { withTimezone: true }),
      providerStatus: text("provider_status").notNull().default("new"),
      resultCategory: text("result_category"),
      providerSha256: text("provider_sha256"),
      providerByteSize: bigint("provider_byte_size", { mode: "number" }),
      pollCount: integer("poll_count").notNull().default(0),
      failureCount: integer("failure_count").notNull().default(0),
      engine: text("engine"),
      definitionsVersion: text("definitions_version"),
      definitionsAt: timestamp("definitions_at", { withTimezone: true }),
      errorCategory: text("error_category"),
      correlationId: uuid("correlation_id").notNull().defaultRandom(),
      createdAt: createdAt(),
    },
    (t) => [
      index("document_scan_queue_idx").on(t.state, t.availableAt),
      check(
        "document_scan_state",
        sql`${t.state} in ('queued','scanning','clean','infected','exhausted','cancelled')`,
      ),
      check("document_scan_provider", sql`${t.provider} in ('clamav','bouncer')`),
      check(
        "document_scan_provider_bounds",
        sql`${t.pollCount} between 0 and 120 and ${t.failureCount} between 0 and 5 and (${t.expectedByteSize} is null or ${t.expectedByteSize} between 1 and 20971520)`,
      ),
      check(
        "document_scan_provider_status",
        sql`${t.providerStatus} in ('new','submitting','pending','scanning','completed','failed','ambiguous','held')`,
      ),
      check("document_scan_attempts", sql`${t.attempts} between 0 and 5`),
      check(
        "document_scan_hash",
        sql`${t.expectedSha256} ~ '^[0-9a-f]{64}$' and (${t.scannedSha256} is null or ${t.scannedSha256} ~ '^[0-9a-f]{64}$')`,
      ),
      check(
        "document_scan_lease",
        sql`(${t.state}='scanning' and ${t.leaseToken} is not null and ${t.leaseUntil} is not null) or (${t.state}<>'scanning' and ${t.leaseToken} is null and ${t.leaseUntil} is null)`,
      ),
      check(
        "document_scan_clean_evidence",
        sql`${t.state}<>'clean' or (${t.scannedSha256} is not null and ${t.scannedSha256}=${t.expectedSha256} and ${t.completedAt} is not null and ((${t.provider}='clamav' and ${t.engine} is not null and ${t.definitionsVersion} is not null and ${t.definitionsAt} is not null) or (${t.provider}='bouncer' and ${t.externalScanId} is not null and ${t.providerStatus}='completed' and ${t.resultCategory}='clean' and ${t.providerSha256}=${t.expectedSha256} and ${t.providerByteSize}=${t.expectedByteSize} and ${t.providerSha256} is not null and ${t.providerByteSize} is not null and ${t.expectedByteSize} is not null and ${t.submissionRevision} is not null)))`,
      ),
    ],
  )
  .enableRLS();
export const documentScanEvents = app
  .table(
    "document_scan_events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      documentId: uuid("document_id")
        .notNull()
        .references(() => documents.id),
      attempt: integer("attempt").notNull(),
      event: text("event").notNull(),
      correlationId: uuid("correlation_id").notNull(),
      createdAt: createdAt(),
    },
    (t) => [index("document_scan_event_idx").on(t.documentId, t.createdAt)],
  )
  .enableRLS();

// Account-wide reservations remain conservative even when provider usage is eventually consistent.
export const scannerBudget = app
  .table(
    "scanner_budget",
    {
      period: text("period").primaryKey(),
      reserved: integer("reserved").notNull().default(0),
      observedUsed: integer("observed_used").notNull().default(0),
      blockedUntil: timestamp("blocked_until", { withTimezone: true }),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check(
        "scanner_budget_bounds",
        sql`${t.reserved} between 0 and 500 and ${t.observedUsed} >= 0`,
      ),
    ],
  )
  .enableRLS();
