import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { connectLocalDatabase } from "../../database/connection.server.ts";
import { localTarget } from "../../database/safety.ts";

const root = new URL("../../", import.meta.url);
const data = fileURLToPath(new URL(".local/postgres/data", root));
const marker = readFileSync(new URL(".local/postgres/project-marker", root), "utf8");
if (marker !== `${localTarget.marker}\n${data}\n`) throw new Error("Unrecognized cluster marker");
const owner = await connectLocalDatabase(); // Endpoint, DB, ownership and role guards first.
const bootstrap = postgres({
  host: localTarget.host,
  port: localTarget.port,
  database: localTarget.database,
  user: "cape_local_bootstrap",
  password: readFileSync(new URL(".local/postgres/bootstrap-password", root), "utf8"),
  max: 1,
  connect_timeout: 5,
});
try {
  const [setting] = await bootstrap`show data_directory`;
  if (setting?.["data_directory"] !== data) throw new Error("Unexpected bootstrap data directory");
  const [role] = await bootstrap`
    select r.*, shobj_description(r.oid, 'pg_authid') as marker from pg_roles r
    where rolname = 'cape_clergy_runtime'
  `;
  const env = new URL(".env.db.runtime.local", root);
  if (role) {
    if (role["marker"] !== "cape-clergy-vault:runtime:local-only" || !existsSync(env))
      throw new Error(
        "Refusing existing unmarked role or missing credentials; manual recovery required",
      );
    if (
      role["rolsuper"] ||
      role["rolbypassrls"] ||
      role["rolcreatedb"] ||
      role["rolcreaterole"] ||
      role["rolreplication"] ||
      !role["rolcanlogin"]
    )
      throw new Error("Unsafe runtime role attributes");
  } else {
    if (existsSync(env)) throw new Error("Runtime credentials already exist without role");
    const password = randomBytes(32).toString("hex");
    await bootstrap.unsafe(
      `CREATE ROLE cape_clergy_runtime LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await bootstrap`comment on role cape_clergy_runtime is 'cape-clergy-vault:runtime:local-only'`;
    writeFileSync(
      env,
      `CAPE_RUNTIME_DATABASE_URL=postgresql://cape_clergy_runtime:${password}@127.0.0.1:55432/cape_clergy_vault_dev\n`,
      { mode: 0o600 },
    );
  }
  const memberships = await bootstrap`
    select 1 from pg_auth_members m join pg_roles r on r.oid = m.member
    where r.rolname = 'cape_clergy_runtime'
  `;
  const owned =
    await bootstrap`select 1 from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'cape_clergy_runtime'`;
  const ownedSchemas =
    await bootstrap`select 1 from pg_namespace n join pg_roles r on r.oid = n.nspowner where r.rolname = 'cape_clergy_runtime'`;
  if (memberships.length || owned.length || ownedSchemas.length)
    throw new Error("Runtime must have no role memberships or owned relations");
  await owner.client.begin(async (tx) => {
    await tx.unsafe(readFileSync(new URL("database/runtime-grants.sql", root), "utf8"));
  });
  console.log(
    "Project runtime role and explicit grants verified; ignored credentials retained (0600).",
  );
} finally {
  await bootstrap.end();
  await owner.close();
}
