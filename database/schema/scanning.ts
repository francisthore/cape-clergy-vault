import { sql } from "drizzle-orm";
import { check, index, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
        sql`${t.state}<>'clean' or (${t.scannedSha256} is not null and ${t.scannedSha256}=${t.expectedSha256} and ${t.engine} is not null and ${t.definitionsVersion} is not null and ${t.definitionsAt} is not null and ${t.completedAt} is not null)`,
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
