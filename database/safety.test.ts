import assert from "node:assert/strict";
import { test } from "node:test";
import { validateLocalUrl, assertLocalDatabase, assertRuntimePrivileges } from "./safety.ts";
import type { Sql } from "postgres";

const safe = "postgresql://cape_clergy_dev:test-password@127.0.0.1:55432/cape_clergy_vault_dev";
test("accept only the dedicated local URL", () => {
  assert.equal(validateLocalUrl(safe), safe);
  for (const candidate of [
    undefined,
    "invalid",
    safe.replace("127.0.0.1", "example.com"),
    safe.replace("55432", "5432"),
    safe.replace("cape_clergy_vault_dev", "other_project"),
    safe.replace("cape_clergy_dev:", "postgres:"),
    safe.replace(":test-password", ""),
    `${safe}?host=production`,
    `${safe}#anything`,
    safe.replace("postgresql:", "https:"),
  ]) {
    assert.throws(() => validateLocalUrl(candidate));
  }
});

test("database identity must match ownership, marker, endpoint and restricted privileges", async () => {
  const identity = {
    database: "cape_clergy_vault_dev",
    username: "cape_clergy_dev",
    owner: "cape_clergy_dev",
    marker: "cape-clergy-vault:phase-2a:local-only",
    superuser: false,
    createdb: false,
    createrole: false,
    bypassrls: false,
    replication: false,
    host: "127.0.0.1",
    port: 55432,
  };
  const fake = (row: unknown) => (async () => [row]) as unknown as Sql;
  await assertLocalDatabase(fake(identity));
  for (const override of [
    { database: "other" },
    { username: "postgres" },
    { owner: "other" },
    { marker: null },
    { host: "10.0.0.1" },
    { port: 5432 },
    { superuser: true },
    { createdb: true },
    { createrole: true },
    { bypassrls: true },
    { replication: true },
  ]) {
    await assert.rejects(assertLocalDatabase(fake({ ...identity, ...override })));
  }
});

test("runtime URL and ownership guards remain distinct from migration credentials", async () => {
  const runtime = safe.replace("cape_clergy_dev:", "cape_clergy_runtime:");
  assert.equal(validateLocalUrl(runtime, true), runtime);
  assert.throws(() => validateLocalUrl(runtime));
  assert.throws(() => validateLocalUrl(safe, true));
  for (const candidate of [
    runtime + "?host=remote",
    runtime.replace("55432", "5432"),
    runtime.replace("127.0.0.1", "example.com"),
  ]) {
    assert.throws(() => validateLocalUrl(candidate, true));
  }
  const flags = {
    membership: false,
    owns_relation: false,
    owns_schema: false,
    creates: false,
    temporary: false,
  };
  const fake = (row: unknown) => (async () => [row]) as unknown as Sql;
  await assertRuntimePrivileges(fake(flags));
  for (const key of Object.keys(flags))
    await assert.rejects(assertRuntimePrivileges(fake({ ...flags, [key]: true })));
});
