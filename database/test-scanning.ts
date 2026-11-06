// Disposable test fixtures only. Real bytes are scanned through an explicitly injected
// TestScanner and the actual restricted scanner login, never via production configuration.
import type { Sql, TransactionSql } from "postgres";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectLocalScanner } from "./scanner.server.ts";
import {
  LocalPrivateStorageProvider,
  type StorageProvider,
} from "../src/lib/documents/storage.server.ts";
import { TestScanner } from "../src/lib/scanning/testing.ts";
import { runScanWorker } from "../src/lib/scanning/worker.server.ts";
export async function scanTestDocument(id: string, storage: StorageProvider) {
  const scanner = await connectLocalScanner();
  try {
    await runScanWorker(scanner.client, storage, new TestScanner(), 1, id);
  } finally {
    await scanner.close();
  }
}
export async function cleanTestScanRows(tx: TransactionSql, submissionIds: string[]) {
  await tx`alter table app.document_scan_events disable trigger user`;
  await tx`delete from app.document_scan_events where document_id in(select id from app.documents where submission_id=any(${submissionIds}))`;
  await tx`alter table app.document_scan_events enable trigger user`;
  const [auditTrigger] =
    await tx`select bool_or(tgenabled<>'D') as enabled from pg_trigger where tgrelid='app.audit_events'::regclass and not tgisinternal`;
  if (auditTrigger?.["enabled"]) await tx`alter table app.audit_events disable trigger user`;
  await tx`delete from app.audit_events where submission_id=any(${submissionIds}) and action like 'document.scan.%'`;
  if (auditTrigger?.["enabled"]) await tx`alter table app.audit_events enable trigger user`;
  await tx`delete from app.document_scans where document_id in(select id from app.documents where submission_id=any(${submissionIds}))`;
}
export async function scanMetadataFixtures(owner: Sql, submissionIds: string[]) {
  const root = await mkdtemp(join(tmpdir(), "cape-metadata-scan-")),
    storage = new LocalPrivateStorageProvider(root);
  try {
    const docs =
      await owner`select id,storage_key from app.documents where submission_id=any(${submissionIds})`;
    for (const d of docs) {
      const saved = await storage.save(
        String(d["storage_key"]),
        new Response("%PDF-1.4\nDisposable RLS metadata fixture\n%%EOF\n").body!,
        new AbortController().signal,
      );
      await owner`update app.documents set state='quarantined',sha256=${saved.sha256},byte_size=${saved.byteSize} where id=${d["id"]}`;
      await owner`insert into app.document_scans(document_id,expected_sha256) values(${d["id"]},${saved.sha256})`;
      await scanTestDocument(String(d["id"]), storage);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
