// Explicit production boundary. No provisioning, migration or connection on import.
import postgres, { type Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { z } from "zod";
import * as schema from "./schema/index.ts";
import { assertRuntimePrivileges } from "./safety.ts";
import {
  auditRoles,
  auditRls,
  auditGrants,
  auditFunctions,
  auditImmutableTriggers,
} from "./security-contract.ts";
const roles = {
  runtime: "cape_clergy_runtime",
  scanner: "cape_clergy_scanner",
  notifications: "cape_clergy_notifications",
  operator: "cape_clergy_dev",
} as const;
export type ProductionRole = keyof typeof roles;
export const productionTargetSchema = z
  .object({
    database: z.literal("cape_clergy_vault"),
    owner: z.literal("cape_clergy_dev"),
    marker: z
      .string()
      .regex(
        /^cape-clergy-vault:production:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    transport: z.enum(["unix", "tls"]),
    host: z.string().min(1).max(253),
    port: z.number().int().min(1024).max(65535),
  })
  .strict()
  .superRefine((v, ctx) => {
    const valid =
      v.transport === "unix"
        ? v.host === "/run/cape-vault/postgresql"
        : /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
            v.host,
          ) &&
          !/^\d+(?:\.\d+){3}$/.test(v.host) &&
          !v.host.endsWith(".invalid");
    if (!valid)
      ctx.addIssue({ code: "custom", message: "Exact approved production host required" });
  });
export type ProductionTarget = z.infer<typeof productionTargetSchema>;
async function protectedFile(path: string, secret = false) {
  if (!isAbsolute(path) || (await realpath(path)) !== path)
    throw Error("Unsafe production configuration path");
  const file = await lstat(path);
  if (
    !file.isFile() ||
    file.isSymbolicLink() ||
    file.nlink !== 1 ||
    file.size > 65536 ||
    (file.mode & 0o022) !== 0 ||
    (secret && (file.mode & 0o077) !== 0) ||
    ![0, ...(secret ? [process.getuid?.()] : [])].includes(file.uid)
  )
    throw Error("Unsafe production configuration permissions");
  // Public target/CA directories are root-owned. Credential mounts may be service-owned;
  // neither path permits group/world writes or symlinks.
  for (let parent = dirname(path); parent !== "/"; parent = dirname(parent)) {
    const info = await lstat(parent);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      ![0, ...(secret ? [process.getuid?.()] : [])].includes(info.uid) ||
      (info.mode & 0o022) !== 0
    )
      throw Error("Unsafe production configuration directory");
  }
  return readFile(path, "utf8");
}
export async function assertProductionIdentity(
  client: Sql,
  target: ProductionTarget,
  role: ProductionRole,
) {
  const [row] =
    await client`select current_database() db,session_user username,current_user effective,
  pg_get_userbyid(d.datdba) owner,shobj_description(d.oid,'pg_database') marker,
  r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,r.rolreplication,
  inet_server_port() port from pg_database d join pg_roles r on r.rolname=session_user where d.datname=current_database()`;
  if (
    !row ||
    row["db"] !== target.database ||
    row["username"] !== roles[role] ||
    row["effective"] !== roles[role] ||
    row["owner"] !== target.owner ||
    row["marker"] !== target.marker ||
    ["rolsuper", "rolcreatedb", "rolcreaterole", "rolbypassrls", "rolreplication"].some(
      (k) => row[k],
    ) ||
    (target.transport === "unix" ? row["port"] !== null : row["port"] !== target.port)
  )
    throw Error("Production database identity rejected");
  if (target.transport === "tls") {
    const [ssl] = await client`select ssl from pg_stat_ssl where pid=pg_backend_pid()`;
    if (ssl?.["ssl"] !== true) throw Error("Production database TLS required");
  }
  const [members] =
    await client`select exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname=session_user)) unsafe`;
  if (members?.["unsafe"]) throw Error("Production role membership rejected");
  if (role !== "operator") await assertRuntimePrivileges(client);
}
export async function assertPilotContract(client: Sql) {
  const [gate] =
    await client`select exists(select 1 from pg_trigger where tgrelid='app.submissions'::regclass and tgname='external_scan_classification' and tgenabled in ('O','A')) ok`;
  if (gate?.["ok"] !== true)
    throw Error("Pilot security migration required before service startup");
  const checks: string[] = [];
  // Catalog-only checks also work through restricted logins; no service reads an
  // owner credential, protected evidence table or migration ledger.
  await auditRoles(client, checks);
  await auditRls(client, checks);
  await auditGrants(client, checks);
  await auditFunctions(client, checks);
  await auditImmutableTriggers(client, checks);
}
export async function connectProductionDatabase(role: ProductionRole) {
  if (process.env["CAPE_DATABASE_MODE"] !== "production" || process.env["CAPE_DATABASE_URL"])
    throw Error("Explicit production mode without owner URL required");
  const target = productionTargetSchema.parse(
    JSON.parse(await protectedFile("/etc/cape-vault/database-target.json")),
  );
  const credential = process.env["CAPE_DATABASE_PASSWORD_FILE"];
  if (
    !credential ||
    !/^\/run\/credentials\/cape-vault-(?:web|scanner|approval|reviewer|operator)\.service\/database-password$/.test(
      credential,
    )
  )
    throw Error("Dedicated service credential required");
  const unit = credential.split("/")[3];
  if (
    (role === "runtime" && unit !== "cape-vault-web.service") ||
    (role === "scanner" && unit !== "cape-vault-scanner.service") ||
    (role === "notifications" &&
      !["cape-vault-approval.service", "cape-vault-reviewer.service"].includes(unit!)) ||
    (role === "operator" && unit !== "cape-vault-operator.service")
  )
    throw Error("Credential scope rejected");
  const password = (await protectedFile(credential, true)).replace(/\n$/, "");
  if (password.length < 24 || /[\r\n\0]/.test(password))
    throw Error("Invalid production credential");
  const ca =
    target.transport === "tls"
      ? await protectedFile("/etc/cape-vault/postgresql-ca.pem")
      : undefined;
  const client = postgres({
    host: target.host,
    port: target.port,
    database: target.database,
    username: roles[role],
    password,
    ssl: ca ? { ca, rejectUnauthorized: true } : false,
    max: role === "operator" ? 1 : 2,
    connect_timeout: 5,
    idle_timeout: 10,
    max_lifetime: 1800,
    connection: {
      application_name: `cape-vault-${role}`,
      TimeZone: "UTC",
      statement_timeout: 15000,
      lock_timeout: 5000,
      idle_in_transaction_session_timeout: 15000,
    },
  });
  try {
    await assertProductionIdentity(client, target, role);
    if (role !== "operator") await assertPilotContract(client);
    return {
      client,
      db: drizzle(client, { schema }),
      close: () => client.end(),
    };
  } catch {
    await client.end();
    throw Error("Production database readiness failed");
  }
}

// Only a role-checked web connection receives the runtime boundary's type marker.
export async function connectProductionRuntime() {
  const connection = await connectProductionDatabase("runtime");
  return { ...connection, runtimeOnly: true as const };
}
