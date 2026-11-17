// A whole fresh cluster is the disposal unit. Never alter triggers or delete history rows.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { localTarget } from "../../database/safety.ts";
import { connectLocalDatabase } from "../../database/connection.server.ts";
import {
  disposablePurpose,
  readDisposableManifest,
} from "../../database/disposable-phase41b.server.ts";
const phase42 = process.argv[2] === "--phase42";
const phase43 = process.argv[2] === "--phase43";
assert.ok(
  process.argv.length === 2 || ((phase42 || phase43) && process.argv.length === 3),
  "Unknown test mode",
);
const repository = fileURLToPath(new URL("../../", import.meta.url));
const bin = [
  process.env["CAPE_PG_BIN"],
  "/usr/lib/postgresql/18/bin",
  "/usr/lib/postgresql/17/bin",
  "/usr/lib/postgresql/14/bin",
].find((p) => p && existsSync(join(p, "initdb")));
assert.ok(bin, "PostgreSQL test binaries required");
// Refuse an active project cluster. This runner never stops or resets the preserved environment.
const preserved = join(repository, ".local/postgres/data");
if (localTarget.port === 55432 && existsSync(preserved)) {
  const status = spawnSync(join(bin, "pg_ctl"), ["-D", preserved, "status"], { stdio: "ignore" });
  assert.equal(
    status.status,
    3,
    "Preserved project cluster must already be stopped before isolated testing",
  );
}
const root = await mkdtemp("/tmp/cape-p41b-test-"),
  runId = randomUUID();
const marker = join(root, "test-manifest.json"),
  data = join(root, "data");
await writeFile(marker, JSON.stringify({ purpose: disposablePurpose, root, runId }), {
  mode: 0o600,
});
const bootstrapPassword = randomBytes(32).toString("hex");
await writeFile(join(root, "bootstrap-password"), bootstrapPassword, { mode: 0o600 });
const inheritedTestRoot = process.env["CAPE_PHASE41B_TEST_ROOT"];
process.env["CAPE_PHASE41B_TEST_ROOT"] = root;
const roles = [
  "cape_clergy_dev",
  "cape_clergy_runtime",
  "cape_clergy_scanner",
  "cape_clergy_notifications",
] as const;
const passwords = Object.fromEntries(roles.map((role) => [role, randomBytes(32).toString("hex")]));
let started = false;
function command(name: string, args: string[]) {
  const result = spawnSync(join(bin!, name), args, { encoding: "utf8" });
  if (result.status !== 0)
    throw Error(
      `${name} failed for isolated Phase 4.1B environment; preserved cluster was not modified`,
    );
}
try {
  command("initdb", [
    "-D",
    data,
    "-U",
    "cape_p41b_bootstrap",
    "--auth-local=scram-sha-256",
    "--auth-host=scram-sha-256",
    `--pwfile=${join(root, "bootstrap-password")}`,
    "--locale=C",
    "--encoding=UTF8",
  ]);
  command("pg_ctl", [
    "-D",
    data,
    "-l",
    join(root, "server.log"),
    "-o",
    `-h 127.0.0.1 -p ${localTarget.port} -k ${root}`,
    "-w",
    "start",
  ]);
  started = true;
  const admin = postgres({
    host: root,
    port: localTarget.port,
    database: "postgres",
    user: "cape_p41b_bootstrap",
    password: bootstrapPassword,
    max: 1,
  });
  try {
    const [setting] = await admin`show data_directory`;
    assert.equal(setting?.["data_directory"], data);
    for (const role of roles) {
      await admin.unsafe(
        `create role ${role} login password '${passwords[role]}' nosuperuser nocreatedb nocreaterole nobypassrls noreplication`,
      );
      await admin.unsafe(`comment on role ${role} is '${disposablePurpose}:${runId}'`);
    }
    await admin.unsafe(`create database ${localTarget.database} owner cape_clergy_dev`);
    await admin.unsafe(`comment on database ${localTarget.database} is '${localTarget.marker}'`);
    await admin.unsafe(`revoke all on database ${localTarget.database} from public`);
    if (phase43) {
      await admin.unsafe("create database cape_clergy_vault owner cape_clergy_dev");
      await admin.unsafe(
        `comment on database cape_clergy_vault is 'cape-clergy-vault:production:${runId}'`,
      );
      await admin.unsafe("revoke all on database cape_clergy_vault from public");
      await admin.unsafe(
        "grant connect on database cape_clergy_vault to cape_clergy_runtime,cape_clergy_scanner,cape_clergy_notifications",
      );
    }
  } finally {
    await admin.end();
  }
  const url = (role: (typeof roles)[number]) =>
    `postgresql://${role}:${passwords[role]}@127.0.0.1:${localTarget.port}/${localTarget.database}`;
  const owner = await connectLocalDatabase(url("cape_clergy_dev"));
  try {
    await owner.client`revoke create on schema public from public`;
    await migrate(owner.db, {
      migrationsFolder: resolve(repository, "database/migrations"),
      migrationsSchema: "cape_migrations",
    });
    for (const role of ["runtime", "scanner", "notifications"])
      await owner.client.unsafe(
        await readFile(join(repository, `database/${role}-grants.sql`), "utf8"),
      );
  } finally {
    await owner.close();
  }
  console.log(
    "Verified fresh disposable cluster; the preserved project environment was not modified.",
  );
  // Explicit environment: no inherited live provider key, owner env file or SMTP configuration.
  const targets = phase43
    ? [["database/phase43.test.ts"], ["database/phase431.test.ts"]]
    : phase42
      ? [
          ["database/phase42.test.ts"],
          ["database/phase421.test.ts"],
          ["database/phase422.test.ts"],
          ["node_modules/@playwright/test/cli.js", "test", "--config=playwright.phase42.config.ts"],
        ]
      : [["database/phase41b.test.ts"]];
  for (const target of targets) {
    const child = spawn(process.execPath, target, {
      cwd: repository,
      stdio: "inherit",
      env: {
        PATH: process.env["PATH"],
        NODE_ENV: "test",
        CAPE_PHASE41B_TEST_ROOT: root,
        CAPE_DATABASE_URL: url("cape_clergy_dev"),
        CAPE_RUNTIME_DATABASE_URL: url("cape_clergy_runtime"),
        CAPE_SCANNER_DATABASE_URL: url("cape_clergy_scanner"),
        CAPE_NOTIFICATION_DATABASE_URL: url("cape_clergy_notifications"),
      },
    });
    const stop = () => child.kill("SIGTERM");
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    try {
      const code = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve(code ?? 1));
      });
      assert.equal(code, 0, "Isolated database/browser checks must pass");
    } finally {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
    }
  }
} finally {
  // Before whole-environment disposal verify the exact fresh tree and live server identity.
  const manifest = await readDisposableManifest();
  assert.equal(manifest.runId, runId);
  assert.equal(await realpath(root), root);
  if (started) {
    const admin = postgres({
      host: root,
      port: localTarget.port,
      database: "postgres",
      user: "cape_p41b_bootstrap",
      password: bootstrapPassword,
      max: 1,
    });
    try {
      const [setting] = await admin`show data_directory`;
      assert.equal(setting?.["data_directory"], data);
    } finally {
      await admin.end();
    }
    command("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  }
  assert.equal(
    spawnSync(join(bin, "pg_ctl"), ["-D", data, "status"], { stdio: "ignore" }).status,
    3,
    "Disposable server must be stopped before disposal",
  );
  await rm(root, { recursive: true });
  if (inheritedTestRoot === undefined) delete process.env["CAPE_PHASE41B_TEST_ROOT"];
  else process.env["CAPE_PHASE41B_TEST_ROOT"] = inheritedTestRoot;
  console.log(
    "Disposed only the verified fresh test cluster; no row-level history cleanup or trigger bypass ran.",
  );
}
