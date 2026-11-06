import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import type { StorageProvider } from "../documents/storage.server.ts";
export async function storageInventory(
  client: Sql,
  storage: StorageProvider,
  root: string,
  verify = false,
) {
  const rows =
    await client`select id,storage_key,state,byte_size::text,sha256,created_at,app.document_is_clean(id) as clean from app.documents`;
  const findings: { documentId: string; issue: string }[] = [];
  const expected = new Set<string>();
  for (const row of rows) {
    const id = String(row["id"]),
      key = String(row["storage_key"]);
    expected.add(key + ".blob");
    expected.add(key + ".part");
    if (
      row["state"] === "pending" &&
      new Date(row["created_at"]).getTime() < Date.now() - 86_400_000
    )
      findings.push({ documentId: id, issue: "stale_pending" });
    let object;
    try {
      object = await storage.open(key);
    } catch {
      if (
        [
          "available",
          "quarantined",
          "scanning",
          "infected",
          "scan_failed",
          "legacy_unscanned",
        ].includes(String(row["state"]))
      )
        findings.push({ documentId: id, issue: "missing_or_unsafe_object" });
      continue;
    }
    try {
      if (row["state"] === "available" && !row["clean"])
        findings.push({ documentId: id, issue: "available_without_clean_evidence" });
      if (["pending", "failed"].includes(String(row["state"])))
        findings.push({ documentId: id, issue: "unfinalized_object" });
      else {
        if (object.byteSize !== Number(row["byte_size"]))
          findings.push({ documentId: id, issue: "size_mismatch" });
        if (verify) {
          const hash = createHash("sha256");
          let chunk;
          while ((chunk = await object.read()) !== null) hash.update(chunk);
          if (hash.digest("hex") !== row["sha256"])
            findings.push({ documentId: id, issue: "checksum_mismatch" });
        }
      }
    } finally {
      await object.close();
    }
  }
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Storage inventory unavailable");
  }

  return {
    documentCount: rows.length,
    findings,
    temporaryCount: names.filter((n) => n.endsWith(".part")).length,
    unknownObjectCount: names.filter((n) => !expected.has(n)).length,
    verified: verify,
  };
}
