// Operator-only forward runner. Each file and its Drizzle-compatible ledger row
// commit together, so PostgreSQL enum additions are visible to the next file.
import assert from "node:assert/strict";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { Sql } from "postgres";
import { migrationFolder, reviewedMigrationPlan } from "./migration-plan.server.ts";

export class MigrationFailure extends Error {
  readonly tag: string;
  constructor(tag: string, cause: unknown) {
    super("Migration failed", { cause });
    this.tag = tag;
  }
}

export async function runProductionMigrations(
  client: Sql,
  committed: (tag: string) => void = () => {},
) {
  // This also rejects an unledgered application schema and every divergent
  // committed hash before any write.
  const initial = await reviewedMigrationPlan(client);
  const migrations = readMigrationFiles({ migrationsFolder: migrationFolder });
  assert.equal(migrations.length, initial.applied + initial.pending.length);
  const tags = initial.pending;
  for (let i = initial.applied; i < migrations.length; i++) {
    const migration = migrations[i]!;
    const tag = tags[i - initial.applied]!;
    try {
      await client.begin(async (tx) => {
        // Match the installed Drizzle PostgreSQL ledger definition exactly.
        if (i === 0) {
          await tx`create schema if not exists cape_migrations`;
          await tx`create table if not exists cape_migrations.__drizzle_migrations (
            id serial primary key, hash text not null, created_at bigint
          )`;
        }
        await tx`lock table cape_migrations.__drizzle_migrations in share row exclusive mode`;
        const current = await reviewedMigrationPlan(tx);
        assert.equal(current.applied, i, "Migration ledger advanced unexpectedly");
        assert.equal(current.pending[0], tag, "Migration order changed");
        for (const statement of migration.sql) await tx.unsafe(statement);
        await tx`insert into cape_migrations.__drizzle_migrations (hash, created_at)
          values (${migration.hash}, ${migration.folderMillis})`;
      });
      committed(tag);
    } catch (error) {
      throw new MigrationFailure(tag, error);
    }
  }
  await reviewedMigrationPlan(client);
}
