import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Sql, TransactionSql } from "postgres";
export const migrationFolder = fileURLToPath(new URL("./migrations", import.meta.url));
export async function reviewedMigrationPlan(db: Sql | TransactionSql) {
  const journal = JSON.parse(
    await readFile(new URL("./migrations/meta/_journal.json", import.meta.url), "utf8"),
  ) as { entries: { idx: number; tag: string; when: number }[] };
  const files = (await readdir(migrationFolder)).filter((f) => f.endsWith(".sql")).sort();
  assert.deepEqual(
    files,
    journal.entries.map((e) => e.tag + ".sql"),
    "Migration journal must match SQL files",
  );
  const expected = await Promise.all(
    journal.entries.map(async (e, i) => {
      assert.equal(e.idx, i);
      return {
        tag: e.tag,
        when: String(e.when),
        hash: createHash("sha256")
          .update(await readFile(new URL(`./migrations/${e.tag}.sql`, import.meta.url)))
          .digest("hex"),
      };
    }),
  );
  const [ledger] = await db`select to_regclass('cape_migrations.__drizzle_migrations') as present`;
  const applied = ledger?.["present"]
    ? await db`select hash,created_at::text from cape_migrations.__drizzle_migrations order by id`
    : [];
  if (!ledger?.["present"]) {
    const [objects] =
      await db`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('app','auth')`;
    assert.equal(objects?.["n"], 0, "Unledgered application objects block initial migration");
  }
  assert.ok(applied.length <= expected.length, "Database is newer than this release");
  for (let i = 0; i < applied.length; i++) {
    assert.equal(applied[i]!["hash"], expected[i]!.hash, "Applied migration hash changed");
    assert.equal(applied[i]!["created_at"], expected[i]!.when, "Applied migration order changed");
  }
  return {
    applied: applied.length,
    pending: expected.slice(applied.length).map((e) => e.tag),
    appliedHashesVerified: true,
  };
}
export async function productionGrants() {
  const files = await Promise.all(
    ["runtime", "scanner", "notifications"].map(async (role) =>
      readFile(new URL(`./${role}-grants.sql`, import.meta.url), "utf8"),
    ),
  );
  return files
    .map((source) =>
      source.replaceAll("DATABASE cape_clergy_vault_dev", "DATABASE cape_clergy_vault"),
    )
    .join("\n");
}
