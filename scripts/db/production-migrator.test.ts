// PG16.15 first-install regression. Owns and disposes only its fresh /tmp cluster.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import {
  MigrationFailure,
  runProductionMigrations,
} from "../../database/production-migrator.server.ts";
import { productionGrants, reviewedMigrationPlan } from "../../database/migration-plan.server.ts";
import {
  auditMigrationLedger,
  auditRoles,
  auditRls,
  auditGrants,
  auditFunctions,
  auditImmutableTriggers,
} from "../../database/security-contract.ts";

const bin = process.env["CAPE_PG16_BIN"] ?? "/usr/lib/postgresql/16/bin";
const share = process.env["CAPE_PG16_SHARE"] ?? "/usr/share/postgresql/16";
const root = await mkdtemp("/tmp/cape-pg16-migrations-");
const data = join(root, "data");
const port = 55439;
let started = false;
function pg(name: string, args: string[]) {
  const run = spawnSync(join(bin, name), args, { encoding: "utf8" });
  if (run.status !== 0)
    throw Error(
      `${name} failed: ${run.stderr}${existsSync(join(root, "server.log")) ? readFileSync(join(root, "server.log"), "utf8") : ""}`,
    );
  return run.stdout;
}
try {
  assert.match(pg("postgres", ["--version"]), /PostgreSQL\) 16\.15\b/);
  pg("initdb", [
    "-D",
    data,
    "-L",
    share,
    "-U",
    "cape_test_bootstrap",
    "--auth-local=trust",
    "--auth-host=reject",
    "--locale=C",
    "--encoding=UTF8",
  ]);
  pg("pg_ctl", [
    "-D",
    data,
    "-p",
    join(bin, "postgres"),
    "-l",
    join(root, "server.log"),
    "-o",
    `-h '' -k ${root} -p ${port}`,
    "-w",
    "start",
  ]);
  started = true;
  const admin = postgres({
    host: root,
    port,
    database: "postgres",
    username: "cape_test_bootstrap",
    max: 1,
    onnotice: () => {},
  });
  try {
    const [version] = await admin`show server_version`;
    assert.match(String(version?.["server_version"]), /^16\.15\b/);
    for (const role of [
      "cape_clergy_dev",
      "cape_clergy_runtime",
      "cape_clergy_scanner",
      "cape_clergy_notifications",
    ])
      await admin.unsafe(
        `create role ${role} login nosuperuser nocreatedb nocreaterole nobypassrls noreplication`,
      );
    await admin`create database cape_clergy_vault owner cape_clergy_dev`;
    await admin`revoke all on database cape_clergy_vault from public`;
  } finally {
    await admin.end();
  }
  const owner = postgres({
    host: root,
    port,
    database: "cape_clergy_vault",
    username: "cape_clergy_dev",
    max: 1,
    onnotice: () => {},
  });
  try {
    await owner`revoke create on schema public from public`;
    // Match the failed first-install target: an empty Drizzle ledger, no app/auth schema.
    await owner`create schema cape_migrations`;
    await owner`create table cape_migrations.__drizzle_migrations (
      id serial primary key, hash text not null, created_at bigint
    )`;
    // Reproduce the exact PostgreSQL rule that caused the 0/41 incident.
    await owner`create schema enum_probe`;
    await owner`create type enum_probe.kind as enum ('base')`;
    await assert.rejects(
      owner.begin(async (tx) => {
        await tx`alter type enum_probe.kind add value 'new'`;
        await tx`select 'new'::enum_probe.kind`;
      }),
      { code: "55P04" },
    );
    await owner`drop schema enum_probe cascade`;
    assert.deepEqual((await reviewedMigrationPlan(owner)).pending.length, 41);
    let committed = 0;
    await assert.rejects(
      runProductionMigrations(owner, () => {
        if (++committed === 3) throw Error("Simulated operator interruption after commit");
      }),
      MigrationFailure,
    );
    assert.equal((await reviewedMigrationPlan(owner)).applied, 3);
    assert.equal(
      (await owner`select count(*)::int n from cape_migrations.__drizzle_migrations`)[0]?.["n"],
      3,
    );
    // A failed ledger insert must roll back the file's earlier SQL as well.
    await owner`create function cape_migrations.fail_test_ledger_insert() returns trigger
      language plpgsql as $$ begin raise exception 'synthetic rollback probe'; end $$`;
    await owner`create trigger fail_test_ledger_insert before insert on cape_migrations.__drizzle_migrations
      for each row execute function cape_migrations.fail_test_ledger_insert()`;
    await assert.rejects(runProductionMigrations(owner), MigrationFailure);
    assert.equal((await reviewedMigrationPlan(owner)).applied, 3);
    assert.equal(
      (await owner`select to_regprocedure('app.request_user_id()') as present`)[0]?.["present"],
      null,
    );
    await owner`drop trigger fail_test_ledger_insert on cape_migrations.__drizzle_migrations`;
    await owner`drop function cape_migrations.fail_test_ledger_insert()`;
    await runProductionMigrations(owner);
    assert.deepEqual(await reviewedMigrationPlan(owner), {
      applied: 41,
      pending: [],
      appliedHashesVerified: true,
    });
    const checks: string[] = [];
    await auditMigrationLedger(owner, checks);
    await owner.begin(async (tx) => tx.unsafe(await productionGrants()));
    await auditRoles(owner, checks);
    await auditRls(owner, checks);
    await auditGrants(owner, checks);
    await auditFunctions(owner, checks);
    await auditImmutableTriggers(owner, checks);
    console.log(JSON.stringify({ postgres: "16.15", migrations: 41, checks }));
  } finally {
    await owner.end();
  }
} finally {
  if (started) pg("pg_ctl", ["-D", data, "-p", join(bin, "postgres"), "-m", "fast", "-w", "stop"]);
  await rm(root, { recursive: true });
}
