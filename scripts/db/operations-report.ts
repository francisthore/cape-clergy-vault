import { randomUUID } from "node:crypto";
import { storageInventory } from "../../src/lib/operations/inventory.server.ts";
import { configuredStorage } from "../../src/lib/documents/storage.server.ts";
import { statfs } from "node:fs/promises";
import { connectLocalDatabase } from "../../database/connection.server.ts";
import { configuredScanner } from "../../src/lib/scanning/scanner.server.ts";
const owner = await connectLocalDatabase();
try {
  const [counts] = await owner.client`select
  (select count(*)::int from app.document_scans where state in ('queued','scanning')) as pending_scans,
  (select count(*)::int from app.document_scans where state in ('queued','scanning') and created_at<now()-interval '10 minutes') as stale_scans,
  (select count(*)::int from app.document_scans where state='exhausted') as exhausted_scans,
  (select count(*)::int from app.documents where state='legacy_unscanned') as legacy_unscanned,
  (select count(*)::int from app.documents where state='infected') as infected,
  (select count(*)::int from app.approval_notifications where delivered_at is null and cancelled_at is null and attempts<8) as pending_approval,
  (select count(*)::int from app.reviewer_notifications where delivered_at is null and cancelled_at is null and attempts<8) as pending_reviewer,
  (select count(*)::int from app.approval_notifications where delivered_at is null and cancelled_at is null and attempts>=8)+
  (select count(*)::int from app.reviewer_notifications where delivered_at is null and cancelled_at is null and attempts>=8) as exhausted_email,
  (select count(*)::int from app.approval_notifications where delivered_at is null and cancelled_at is null and created_at<now()-interval '15 minutes') as stale_approval,
  (select count(*)::int from app.reviewer_notifications where delivered_at is null and cancelled_at is null and created_at<now()-interval '15 minutes') as stale_reviewer,
  (select count(*)::int from app.audit_events where created_at>now()-interval '1 hour' and outcome in ('error','denied')) as recent_audit_errors,
  (select count(*)::int from app.audit_events where created_at>now()-interval '1 hour' and outcome='denied') as recent_authorization_denials,
  (select count(*)::int from app.audit_events where created_at>now()-interval '1 hour' and outcome='error' and action like 'document.download.%') as recent_download_errors,
  (select count(*)::int from app.documents where state='failed' and created_at>now()-interval '1 hour') as recent_upload_failures`;
  const scanner = await configuredScanner().health();
  let capacity: { freeBytes: number; freeInodes: number } | null = null;
  try {
    const s = await statfs(process.env["CAPE_STORAGE_ROOT"] ?? ".local/storage");
    capacity = { freeBytes: s.bavail * s.bsize, freeInodes: s.ffree };
  } catch {
    /* Report absence safely. */
  }
  const inventory = await storageInventory(
    owner.client,
    configuredStorage(),
    process.env["CAPE_STORAGE_ROOT"] ?? ".local/storage",
  );
  console.log(
    JSON.stringify({
      event: "operations.snapshot",
      correlationId: randomUUID(),
      counts,
      inventory: {
        inconsistencies: inventory.findings.length,
        unknownObjects: inventory.unknownObjectCount,
        temporaryObjects: inventory.temporaryCount,
      },
      scanner: {
        ready: scanner.ready,
        reachable: scanner.reachable,
        engineAvailable: scanner.engineAvailable,
        signaturesAvailable: scanner.signaturesAvailable,
        fresh: scanner.fresh,
        testObjectPassed: scanner.testObjectPassed,
        category: scanner.category ?? null,
      },
      capacity,
      inventoryCommand: "bun run storage:inventory -- --verify",
    }),
  );
} finally {
  await owner.close();
}
