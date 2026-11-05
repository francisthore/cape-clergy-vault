import type { Sql } from "postgres";

export const localTarget = {
  host: "127.0.0.1",
  port: 55432,
  database: "cape_clergy_vault_dev",
  user: "cape_clergy_dev",
  marker: "cape-clergy-vault:phase-2a:local-only",
} as const;

export function validateLocalUrl(value: string | undefined, runtime = false): string {
  if (!value) throw new Error("CAPE_DATABASE_URL is required in .env.db.local");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid local database URL");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== localTarget.host ||
    url.port !== String(localTarget.port) ||
    url.pathname !== `/${localTarget.database}` ||
    url.username !== (runtime ? "cape_clergy_runtime" : localTarget.user) ||
    !url.password ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error(
      "Refusing database target: only the dedicated Cape Clergy local database is allowed",
    );
  return value;
}

export async function assertLocalDatabase(client: Sql, runtime = false): Promise<void> {
  const [identity] = await client<
    {
      database: string;
      username: string;
      owner: string;
      marker: string | null;
      superuser: boolean;
      createdb: boolean;
      createrole: boolean;
      bypassrls: boolean;
      replication: boolean;
      host: string;
      port: number;
    }[]
  >`
    select current_database() as database, current_user as username,
      pg_get_userbyid(d.datdba) as owner,
      shobj_description(d.oid, 'pg_database') as marker,
      r.rolsuper as superuser, r.rolcreatedb as createdb,
      r.rolcreaterole as createrole, r.rolbypassrls as bypassrls, r.rolreplication as replication,
      host(inet_server_addr()) as host, inet_server_port() as port
    from pg_database d join pg_roles r on r.rolname = current_user
    where d.datname = current_database()
  `;
  if (
    !identity ||
    identity.database !== localTarget.database ||
    identity.username !== (runtime ? "cape_clergy_runtime" : localTarget.user) ||
    identity.owner !== localTarget.user ||
    identity.marker !== localTarget.marker ||
    identity.host !== localTarget.host ||
    identity.port !== localTarget.port ||
    identity.superuser ||
    identity.createdb ||
    identity.createrole ||
    identity.bypassrls ||
    identity.replication
  ) {
    throw new Error(
      "Refusing database: local identity, ownership, marker or privilege check failed",
    );
  }
}

// Runtime cannot inherit any owner/admin role or own any schema/relation.
export async function assertRuntimePrivileges(client: Sql): Promise<void> {
  const [row] = await client`
    select
      exists(select 1 from pg_auth_members where member = (select oid from pg_roles where rolname = current_user)) as membership,
      exists(select 1 from pg_class where relowner = (select oid from pg_roles where rolname = current_user)) as owns_relation,
      exists(select 1 from pg_namespace where nspowner = (select oid from pg_roles where rolname = current_user)) as owns_schema,
      has_database_privilege(current_user, current_database(), 'CREATE') as creates,
      has_database_privilege(current_user, current_database(), 'TEMP') as temporary
  `;
  if (!row || Object.values(row).some(Boolean))
    throw new Error("Unsafe runtime ownership or privileges");
}
