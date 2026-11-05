import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { localTarget } from "../../database/safety.ts";

// No sudo, system service commands, existing clusters, or inherited DATABASE_URL.
const root = fileURLToPath(new URL("../../", import.meta.url));
const local = resolve(root, ".local/postgres");
const data = resolve(local, "data");
const marker = resolve(local, "project-marker");
const envFile = resolve(root, ".env.db.local");
const command = process.argv[2];
if (!["init", "start", "stop"].includes(command ?? "")) throw new Error("Use init, start or stop");
const candidates = [
  process.env["CAPE_PG_BIN"],
  "/usr/lib/postgresql/18/bin",
  "/usr/lib/postgresql/17/bin",
  "/usr/lib/postgresql/14/bin",
];
const bin = candidates.find((path) => path && existsSync(resolve(path, "initdb")));
if (!bin)
  throw new Error(
    "PostgreSQL server binaries unavailable. See docs/database.md; no services were changed.",
  );
function run(program: string, args: string[]) {
  const result = spawnSync(resolve(bin!, program), args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${program} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
function assertMarker() {
  if (!existsSync(marker) || readFileSync(marker, "utf8") !== `${localTarget.marker}\n${data}\n`) {
    throw new Error("Refusing unmarked PostgreSQL directory");
  }
}
function start() {
  assertMarker();
  const status = spawnSync(resolve(bin!, "pg_ctl"), ["-D", data, "status"]);
  if (status.status === 0) return;
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    resolve(local, "server.log"),
    "-o",
    `-h 127.0.0.1 -p ${localTarget.port} -k ${local}`,
    "-w",
    "start",
  ]);
}
if (command === "init") {
  // Refuse overwrites, including partial initializations; recovery is manual.
  if (existsSync(local) || existsSync(envFile))
    throw new Error("Local setup already exists. Use db:local:start or follow recovery docs.");
  mkdirSync(local, { recursive: true, mode: 0o700 });
  const adminPassword = randomBytes(32).toString("hex");
  const password = randomBytes(32).toString("hex");
  const pwFile = resolve(local, "bootstrap-password");
  writeFileSync(pwFile, adminPassword, { mode: 0o600 });
  run("initdb", [
    "-D",
    data,
    "-U",
    "cape_local_bootstrap",
    "--auth-local=scram-sha-256",
    "--auth-host=scram-sha-256",
    `--pwfile=${pwFile}`,
    "--encoding=UTF8",
    "--locale=C",
  ]);
  writeFileSync(marker, `${localTarget.marker}\n${data}\n`, { mode: 0o600 });
  start();
  const admin = postgres({
    host: localTarget.host,
    port: localTarget.port,
    user: "cape_local_bootstrap",
    password: adminPassword,
    database: "postgres",
    max: 1,
    connect_timeout: 5,
  });
  try {
    // Provision only after proving this server is the newly initialized private cluster.
    const [setting] = await admin`show data_directory`;
    if (setting?.["data_directory"] !== data)
      throw new Error("Refusing bootstrap: unexpected data directory");
    // Generated hex password; identifiers are constants, never supplied by the caller.
    await admin.unsafe(
      `CREATE ROLE cape_clergy_dev LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.unsafe("CREATE DATABASE cape_clergy_vault_dev OWNER cape_clergy_dev");
    await admin.unsafe(`COMMENT ON DATABASE cape_clergy_vault_dev IS '${localTarget.marker}'`);
    await admin.unsafe("REVOKE ALL ON DATABASE cape_clergy_vault_dev FROM PUBLIC");
    const app = postgres({
      host: localTarget.host,
      port: localTarget.port,
      user: localTarget.user,
      password,
      database: localTarget.database,
      max: 1,
    });
    try {
      await app.unsafe("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    } finally {
      await app.end();
    }
    writeFileSync(
      envFile,
      `CAPE_DATABASE_URL=postgresql://${localTarget.user}:${password}@${localTarget.host}:${localTarget.port}/${localTarget.database}\n`,
      { mode: 0o600 },
    );
    console.log(
      "Dedicated local cluster initialized; credentials written to ignored .env.db.local (0600).",
    );
  } finally {
    await admin.end();
  }
} else if (command === "start") {
  start();
  console.log("Project-local PostgreSQL started.");
} else {
  assertMarker();
  run("pg_ctl", ["-D", data, "-m", "smart", "-w", "stop"]);
  console.log("Project-local PostgreSQL stopped; data retained.");
}
