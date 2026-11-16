// Test-only provenance check; production/local connection guards are unchanged.
import assert from "node:assert/strict";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { Sql } from "postgres";
const purpose = "cape-clergy-vault:phase41b:disposable-test-only";
export type DisposableManifest = { purpose: string; root: string; runId: string };
export async function readDisposableManifest(): Promise<DisposableManifest> {
  const root = process.env["CAPE_PHASE41B_TEST_ROOT"];
  assert.ok(
    root && /^\/tmp\/cape-p41b-test-[A-Za-z0-9]+$/.test(root),
    "Phase 4.1B requires its isolated test runner",
  );
  assert.equal(await realpath(root), root, "Disposable root must not be a symlink");
  const stat = await lstat(root),
    marker = join(root, "test-manifest.json"),
    file = await lstat(marker);
  assert.ok(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (stat.mode & 0o077) === 0 &&
      stat.uid === process.getuid?.(),
  );
  assert.ok(
    file.isFile() &&
      !file.isSymbolicLink() &&
      (file.mode & 0o077) === 0 &&
      file.uid === process.getuid?.(),
  );
  const manifest = JSON.parse(await readFile(marker, "utf8")) as DisposableManifest;
  assert.equal(manifest.purpose, purpose);
  assert.equal(manifest.root, root);
  assert.match(manifest.runId, /^[0-9a-f-]{36}$/);
  return manifest;
}
export async function assertDisposableDatabase(db: Sql, manifest: DisposableManifest) {
  const [row] =
    await db`select shobj_description(oid,'pg_authid') as marker from pg_roles where rolname=current_user`;
  assert.equal(
    row?.["marker"],
    `${purpose}:${manifest.runId}`,
    "Connection must belong to this verified disposable cluster",
  );
}
export const disposablePurpose = purpose;
