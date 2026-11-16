// Phase 4.3: reviewed security contract shared by the read-only database audits.
//
// Expectations are derived from the repository (migration files/journal) or are explicit,
// reviewed pins (role execute sets, auth-provider tables). Nothing here mutates the
// database, bypasses a trigger, deletes evidence or grants a privilege. Changing a pin
// below is a deliberate security review decision, not a way to make an audit pass.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Sql } from "postgres";
import {
  appendOnlyTables,
  auditFixtureState,
  fixtureIdentityPattern,
} from "./test-fixture-audit.ts";

export const APP_ROLES = [
  "cape_clergy_runtime",
  "cape_clergy_scanner",
  "cape_clergy_notifications",
] as const;

// Better Auth owns these; they intentionally have no RLS. The runtime role reaches them only
// through the verified auth layer. Any other table in `auth` or `app` must have RLS.
export const AUTH_PROVIDER_TABLES = ["accounts", "sessions", "users", "verifications"] as const;

// Tables that must keep RLS. Every other `app` table must also have it (checked generically);
// this list pins the security-relevant ones so that a rename/removal is noticed.
export const REQUIRED_RLS_TABLES = [
  "account_approval_events",
  "administration_bootstrap",
  "administration_events",
  "approval_notifications",
  "approver_bootstrap",
  "audit_events",
  "chat_messages",
  "clergy_profiles",
  "document_scan_events",
  "document_scans",
  "documents",
  "operational_grants",
  "popia_consent_events",
  "rate_limits",
  "review_decisions",
  "reviewer_assignments",
  "reviewer_events",
  "reviewer_invitations",
  "reviewer_notifications",
  "role_assignments",
  "scanner_budget",
  "settings_managers",
  "submission_events",
  "submissions",
] as const;

// Operator-only tables: no application or worker role may hold any privilege on them.
export const OPERATOR_ONLY_TABLES = [
  "administration_bootstrap",
  "administration_events",
  "approver_bootstrap",
  "operational_grants",
  "reviewer_invitations",
  "reviewer_events",
  "reviewer_notifications",
  "approval_notifications",
  "document_scans",
  "document_scan_events",
  "scanner_budget",
  "settings_managers",
] as const;

// Append-only histories with the original per-row/truncate triggers (checked by auditFixtureState)
// plus the later single-trigger immutable tables introduced for operator evidence.
export const SINGLE_TRIGGER_IMMUTABLE = [
  ["administration_bootstrap", "immutable_administration_bootstrap"],
  ["administration_events", "immutable_administration_events"],
  ["approver_bootstrap", "bootstrap_immutable"],
] as const;

// Reviewed execute sets. These are the exact functions each restricted role may call.
export const RUNTIME_FUNCTIONS = [
  "accept_reviewer_invitation",
  "access_identity",
  "assignment_notification_allowed",
  "author_assignment_status",
  "author_review_feedback",
  "can_chat",
  "can_review_submission",
  "consume_rate_limit",
  "coordinate_assignment",
  "coordination_inbox",
  "coordination_revoke_assignment",
  "decide_registration",
  "decide_review",
  "document_account_allowed",
  "document_is_clean",
  "exclude_draft_document",
  "fail_document",
  "finalize_document",
  "has_consent",
  "has_operational",
  "inspect_reviewer_invitation",
  "is_active",
  "is_admin",
  "is_approver",
  "is_reviewer",
  "is_settings_manager",
  "manage_access",
  "owner_document_verification",
  "provision_clergy",
  "record_document_access",
  "registration_detail",
  "registration_list",
  "request_user_id",
  "require_approver",
  "require_delegation",
  "require_settings_manager",
  "require_submission_account",
  "reserve_email_test",
  "resolve_email_settings",
  "reviewer_author",
  "save_draft",
  "save_email_settings",
  "transition_submission",
];
export const SCANNER_FUNCTIONS = [
  "accept_bouncer_scan",
  "claim_bouncer_scan",
  "claim_document_scan",
  "finish_bouncer_scan",
  "finish_document_scan",
  "reserve_bouncer_scan",
];
export const NOTIFICATION_FUNCTIONS = [
  "check_notification",
  "claim_notification",
  "finish_notification",
  "prepare_notification",
  "resolve_email_settings",
];
// Operator/internal functions that must never be reachable by any restricted role.
export const OPERATOR_FUNCTIONS = [
  "reviewer_operator",
  "reviewer_operator_internal",
  "reviewer_operator_event",
  "invalidate_reviewer_invitation",
  "snapshot_submission",
  "notification_eligible",
  "notification_eligible_before_phase42",
  "queue_registration_received",
  "require_notification_worker",
  "operator_administration",
  "require_operational",
  "eligible_operational_identity",
  "queue_submission_received",
  "cancel_intake_on_assignment",
];

// Runtime table privileges reviewed through Phase 4.2.2 (any of SELECT/INSERT/UPDATE/DELETE).
export const RUNTIME_TABLES = [
  "app.account_approval_events",
  "app.audit_events",
  "app.chat_messages",
  "app.chat_notification_preferences",
  "app.clergy_profiles",
  "app.documents",
  "app.email_domains",
  "app.email_settings",
  "app.email_settings_history",
  "app.popia_consent_events",
  "app.rate_limits",
  "app.review_decisions",
  "app.reviewer_assignments",
  "app.role_assignments",
  "app.submission_events",
  "app.submissions",
  "auth.accounts",
  "auth.sessions",
  "auth.users",
  "auth.verifications",
];

export type ContractResult = { checks: string[]; migrations: number; rlsTables: number };

const names = (rows: readonly Record<string, unknown>[], key: string) =>
  rows.map((r) => String(r[key])).sort();

export async function migrationFiles(directory = "database/migrations") {
  const files = (await readdir(directory)).filter((f) => f.endsWith(".sql")).sort();
  const entries = await Promise.all(
    files.map(async (name) => ({
      name,
      hash: createHash("sha256")
        .update(await readFile(join(directory, name)))
        .digest("hex"),
    })),
  );
  return entries;
}

export async function auditMigrationLedger(owner: Sql, checks: string[]) {
  const files = await migrationFiles();
  const journal = JSON.parse(await readFile("database/migrations/meta/_journal.json", "utf8")) as {
    entries: { tag: string }[];
  };
  assert.deepEqual(
    journal.entries.map((e) => `${e.tag}.sql`).sort(),
    files.map((f) => f.name),
    "Migration journal and SQL files must correspond one-to-one",
  );
  const ledger = await owner`select id, hash from cape_migrations.__drizzle_migrations order by id`;
  assert.equal(ledger.length, files.length, "Ledger row count must equal reviewed migration files");
  // Drizzle records files in journal order; verify each exact hash at its exact position.
  const ordered = journal.entries.map((e) => files.find((f) => f.name === `${e.tag}.sql`)!);
  ledger.forEach((row, i) =>
    assert.equal(
      row["hash"],
      ordered[i]!.hash,
      `Applied migration ${i + 1} (${ordered[i]!.name}) must match its reviewed file hash`,
    ),
  );
  checks.push(
    `${files.length} migration files, journal entries and ledger hashes match in order (latest ${ordered.at(-1)!.name})`,
  );
  return files.length;
}

export async function auditRoles(owner: Sql, checks: string[]) {
  const roles =
    await owner`select rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication
    from pg_roles where rolname = any(${[...APP_ROLES]})`;
  assert.equal(roles.length, APP_ROLES.length, "All restricted application roles must exist");
  for (const r of roles)
    for (const attribute of [
      "rolsuper",
      "rolcreaterole",
      "rolcreatedb",
      "rolbypassrls",
      "rolreplication",
    ])
      assert.equal(r[attribute], false, `${r["rolname"]} must not have ${attribute}`);
  const memberships = await owner`select r.rolname from pg_auth_members am
    join pg_roles r on r.oid=am.member where r.rolname = any(${[...APP_ROLES]})`;
  assert.equal(memberships.length, 0, "Restricted roles must not inherit other roles");
  const owned =
    await owner`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('app','auth') and pg_get_userbyid(c.relowner) = any(${[...APP_ROLES]})`;
  assert.equal(owned.length, 0, "Restricted roles own no application relations");
  checks.push(
    "Restricted roles: no superuser/createrole/createdb/bypassrls/replication, no memberships, own nothing",
  );
}

export async function auditRls(owner: Sql, checks: string[]) {
  const tables = await owner`select n.nspname as schema, c.relname as name, c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('app','auth') and c.relkind in ('r','p')`;
  const app = tables.filter((t) => t["schema"] === "app");
  const unprotected = app.filter((t) => !t["rls"]).map((t) => t["name"]);
  assert.equal(unprotected.length, 0, "Every application table must have row-level security");
  const present = new Set(app.map((t) => t["name"]));
  for (const required of REQUIRED_RLS_TABLES)
    assert.ok(present.has(required), `Required RLS table ${required} must exist`);
  const authUnprotected = tables
    .filter((t) => t["schema"] === "auth" && !t["rls"])
    .map((t) => String(t["name"]))
    .sort();
  assert.deepEqual(
    authUnprotected,
    [...AUTH_PROVIDER_TABLES],
    "Only the Better Auth provider tables may lack RLS",
  );
  // Partitioned or rule-based bypasses: forbid views in app schema reachable by runtime roles.
  const views =
    await owner`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('app','auth') and c.relkind in ('v','m')`;
  assert.equal(views.length, 0, "No views/materialized views may bypass table RLS");
  checks.push(
    `${app.length} application tables, all with RLS; ${REQUIRED_RLS_TABLES.length} pinned tables present; auth provider tables exactly ${AUTH_PROVIDER_TABLES.join("/")}`,
  );
  return app.length;
}

export async function auditGrants(owner: Sql, checks: string[]) {
  for (const [role, expected] of [
    ["cape_clergy_runtime", RUNTIME_FUNCTIONS],
    ["cape_clergy_scanner", SCANNER_FUNCTIONS],
    ["cape_clergy_notifications", NOTIFICATION_FUNCTIONS],
  ] as const) {
    const rows =
      await owner`select distinct p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('app','auth','public') and has_function_privilege(${role},p.oid,'EXECUTE')
      and p.proowner <> (select oid from pg_roles where rolname=${role})
      and p.pronamespace <> 'pg_catalog'::regnamespace`;
    assert.deepEqual(
      names(rows, "proname"),
      [...expected].sort(),
      `${role} execute set must match review`,
    );
  }
  const reachable =
    await owner`select p.proname, r.rolname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join pg_roles r where n.nspname='app' and p.proname = any(${[...OPERATOR_FUNCTIONS]})
    and r.rolname = any(${[...APP_ROLES]}) and has_function_privilege(r.rolname,p.oid,'EXECUTE')`;
  assert.equal(reachable.length, 0, "Operator functions are unreachable by restricted roles");

  const runtimeTables = await owner`select n.nspname||'.'||c.relname as t from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('app','auth') and c.relkind in ('r','p')
    and (has_table_privilege('cape_clergy_runtime',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege('cape_clergy_runtime',c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))`;
  assert.deepEqual(
    names(runtimeTables, "t"),
    [...RUNTIME_TABLES].sort(),
    "Runtime table access must match review",
  );
  for (const role of ["cape_clergy_scanner", "cape_clergy_notifications"]) {
    const rows = await owner`select n.nspname||'.'||c.relname as t from pg_class c
      join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('app','auth') and c.relkind in ('r','p')
      and (has_table_privilege(${role},c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(${role},c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))`;
    assert.equal(rows.length, 0, `${role} must have no direct table or column privileges`);
  }
  const operatorOnly =
    await owner`select r.rolname, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join pg_roles r where n.nspname='app' and c.relname = any(${[...OPERATOR_ONLY_TABLES]})
    and r.rolname = any(${[...APP_ROLES]})
    and (has_table_privilege(r.rolname,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      or has_any_column_privilege(r.rolname,c.oid,'SELECT,INSERT,UPDATE'))`;
  assert.equal(operatorOnly.length, 0, "Operator-only tables are inaccessible to restricted roles");
  const [denied] = await owner`select
    has_any_column_privilege('cape_clergy_runtime','app.submissions','UPDATE') as submission_update,
    has_any_column_privilege('cape_clergy_runtime','app.submissions','INSERT') as submission_insert,
    has_any_column_privilege('cape_clergy_runtime','app.review_decisions','INSERT') as decision_insert,
    has_any_column_privilege('cape_clergy_runtime','app.documents','UPDATE') as document_update,
    has_any_column_privilege('cape_clergy_runtime','app.role_assignments','INSERT') as role_insert,
    has_any_column_privilege('cape_clergy_runtime','app.reviewer_assignments','INSERT') as assignment_insert,
    has_any_column_privilege('cape_clergy_runtime','app.reviewer_assignments','UPDATE') as assignment_update,
    has_function_privilege('cape_clergy_runtime','app.claim_document_scan(uuid)','EXECUTE') as scanner_claim,
    has_function_privilege('cape_clergy_runtime','app.finish_document_scan(uuid,uuid,text,text,text,text,timestamptz,text)','EXECUTE') as scanner_finish,
    has_function_privilege('cape_clergy_scanner','app.finalize_document(uuid,bigint,text)','EXECUTE') as scanner_finalize,
    has_function_privilege('cape_clergy_notifications','app.decide_review(uuid,integer,text,text,text,uuid)','EXECUTE') as notifier_decide,
    has_function_privilege('cape_clergy_notifications','app.manage_access(text,text,text,text,text,text,uuid,uuid,text,text)','EXECUTE') as notifier_access`;
  assert.ok(denied);
  for (const [k, v] of Object.entries(denied))
    assert.equal(v, false, `Denied privilege ${k} must stay denied`);
  checks.push(
    `Role grants: runtime ${RUNTIME_FUNCTIONS.length} / scanner ${SCANNER_FUNCTIONS.length} / notification ${NOTIFICATION_FUNCTIONS.length} functions exactly match; runtime tables exactly ${RUNTIME_TABLES.length}; worker roles have no table/column privileges; ${OPERATOR_ONLY_TABLES.length} operator-only tables and direct status/decision/assignment/role writes denied`,
  );
}

export async function auditFunctions(owner: Sql, checks: string[]) {
  const unsafe =
    await owner`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and p.prosecdef and not coalesce(p.proconfig @> array['search_path=pg_catalog'],false)`;
  assert.equal(unsafe.length, 0, "Every SECURITY DEFINER function must pin search_path=pg_catalog");
  const [counts] =
    await owner`select count(*) filter(where p.prosecdef)::int as definers, count(*)::int as total
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app'`;
  const publicExecute =
    await owner`select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
    lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where n.nspname in ('app','auth','public') and a.grantee=0 and a.privilege_type='EXECUTE'`;
  assert.equal(publicExecute.length, 0, "No PUBLIC EXECUTE on application functions");
  const owners =
    await owner`select distinct pg_get_userbyid(p.proowner) as o, r.rolsuper, r.rolbypassrls
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='app'`;
  assert.equal(owners.length, 1, "All application functions share one non-superuser owner");
  assert.equal(owners[0]!["rolsuper"], false, "Function owner must not be a superuser");
  assert.equal(owners[0]!["rolbypassrls"], false, "Function owner must not bypass RLS");
  checks.push(
    `${counts!["definers"]}/${counts!["total"]} application functions are SECURITY DEFINER, all pin search_path=pg_catalog, none is PUBLIC-executable, single non-superuser owner ${owners[0]!["o"]}`,
  );
}

export async function auditImmutableTriggers(owner: Sql, checks: string[]) {
  const disabled =
    await owner`select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and not t.tgisinternal and t.tgenabled='D'`;
  assert.equal(disabled.length, 0, "No application trigger may be disabled");
  const replicaOnly =
    await owner`select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and not t.tgisinternal and t.tgenabled='R'`;
  assert.equal(replicaOnly.length, 0, "No application trigger may run only in replica mode");
  for (const [table, trigger] of SINGLE_TRIGGER_IMMUTABLE) {
    const rows = await owner`select t.tgenabled, t.tgtype,
      t.tgfoid='app.reject_history_mutation()'::regprocedure as ok
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app' and c.relname=${table} and t.tgname=${trigger}`;
    assert.equal(rows.length, 1, `${table} must retain ${trigger}`);
    assert.ok(["O", "A"].includes(String(rows[0]!["tgenabled"])), `${table}.${trigger} enabled`);
    assert.equal(rows[0]!["ok"], true, `${table}.${trigger} must reject mutation`);
    assert.equal(
      Number(rows[0]!["tgtype"]) & (8 | 16 | 32),
      8 | 16 | 32,
      `${table}.${trigger} covers update/delete/truncate`,
    );
  }
  // Operational workflow triggers introduced by 4.2/4.2.2 (notification intent, revocation, intake).
  const required = [
    ["submissions", "submission_received"],
    ["submissions", "assignment_notification_superseded"],
    ["reviewer_assignments", "intake_assignment_created"],
    ["reviewer_assignments", "assignment_notification_revoked"],
    ["reviewer_notifications", "reviewer_notification_cancellation"],
    ["clergy_profiles", "registration_provisioned"],
    ["clergy_profiles", "revoke_suspended_sessions"],
    ["documents", "document_reservation_lock"],
  ] as const;
  for (const [table, trigger] of required) {
    const rows = await owner`select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relname=${table}
      and t.tgname=${trigger} and t.tgenabled in ('O','A')`;
    assert.equal(rows.length, 1, `${table}.${trigger} workflow trigger must remain enabled`);
  }
  checks.push(
    `Immutable history: ${appendOnlyTables.length} original histories + ${SINGLE_TRIGGER_IMMUTABLE.length} operator-evidence tables keep enabled reject triggers; ${required.length} workflow triggers enabled; none disabled/replica-only`,
  );
}

// Distinguish retained development captures (kept, never deleted) from leftover disposable
// fixtures (reported). The audit fails only on exposure (permissions) or malformed captures.
export async function auditCaptures(checks: string[], directory = ".local/email") {
  const info = await stat(directory).catch(() => undefined);
  if (!info) {
    checks.push(`Capture directory ${directory} absent (nothing retained)`);
    return { fixture: 0, retainedDevelopment: 0 };
  }
  assert.ok(info.isDirectory());
  assert.equal(info.mode & 0o077, 0, `${directory} must not be group/world accessible`);
  const fixtureRecipient = new RegExp(fixtureIdentityPattern.slice(0, -1) + "@example\\.invalid$");
  let fixture = 0;
  let retainedDevelopment = 0;
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    const file = await stat(path);
    if (!file.isFile()) continue;
    assert.equal(file.mode & 0o077, 0, `${path} must be owner-only`);
    const parsed = JSON.parse(await readFile(path, "utf8")) as { to?: unknown };
    const recipients = ([] as unknown[]).concat(parsed.to ?? []).map(String);
    if (recipients.length && recipients.every((r) => fixtureRecipient.test(r))) fixture++;
    else retainedDevelopment++;
  }
  checks.push(
    `Captures in ${directory}: ${retainedDevelopment} retained development, ${fixture} disposable-fixture; all owner-only; none required to be deleted`,
  );
  return { fixture, retainedDevelopment };
}

const credentialPatterns: [string, RegExp][] = [
  ["server private key block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["database URL with password", /postgres(?:ql)?:\/\/[^\s:@/"']+:[^\s@/"']+@/],
  ["Resend API key", /\bre_[A-Za-z0-9]{16,}\b/],
  ["Bouncer secret/provider implementation", /BOUNCER_API_KEY|api\.usebouncer\.dev|BouncerScanner/],
  [
    // Better Auth's bundled env helper legitimately names BETTER_AUTH_SECRET (name only, no value),
    // so that secret is covered by exact configured-value matching below instead of by name.
    "project server-only env variable name",
    /CAPE_(?:RUNTIME_|SCANNER_|NOTIFICATION_)?DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY/,
  ],
];

// Always executes: a missing build output is a hard failure, never a silent skip.
export async function auditBrowserArtifacts(checks: string[], root = ".output/public") {
  const info = await stat(root).catch(() => undefined);
  assert.ok(
    info?.isDirectory(),
    `Browser artifacts missing at ${root}: run the production build before auditing (the scan is never skipped)`,
  );
  const configured = [
    "BETTER_AUTH_SECRET",
    "RESEND_API_KEY",
    "BOUNCER_API_KEY",
    "CAPE_RUNTIME_DATABASE_URL",
    "CAPE_DATABASE_URL",
    "CAPE_NOTIFICATION_DATABASE_URL",
    "CAPE_SCANNER_DATABASE_URL",
  ]
    .map((k) => process.env[k])
    .filter((s): s is string => !!s && s.length >= 8);
  for (const k of [
    "CAPE_RUNTIME_DATABASE_URL",
    "CAPE_DATABASE_URL",
    "CAPE_SCANNER_DATABASE_URL",
    "CAPE_NOTIFICATION_DATABASE_URL",
  ]) {
    const value = process.env[k];
    if (value) configured.push(decodeURIComponent(new URL(value).password));
  }
  const secrets = configured.filter((s) => s.length >= 8);
  let artifacts = 0;
  async function scan(path: string) {
    for (const file of await readdir(path, { withFileTypes: true })) {
      const p = join(path, file.name);
      if (file.isDirectory()) await scan(p);
      else if (/\.(js|mjs|cjs|html|json|map|css|webmanifest|txt|svg)$/.test(file.name)) {
        const content = await readFile(p, "utf8");
        for (const [label, pattern] of credentialPatterns)
          assert.ok(!pattern.test(content), `${p}: browser artifact must not contain ${label}`);
        assert.ok(
          secrets.every((s) => !content.includes(s)),
          `${p}: no configured private credential in browser artifacts`,
        );
        artifacts++;
      }
    }
  }
  await scan(root);
  assert.ok(artifacts > 0, "Browser artifact scan inspected no files");
  checks.push(
    `${artifacts} browser artifacts scanned for ${credentialPatterns.length} credential/server-only pattern classes and ${secrets.length} configured secret values (always executed)`,
  );
  return artifacts;
}

export async function runSecurityContract(owner: Sql): Promise<ContractResult> {
  const checks: string[] = [];
  const migrations = await auditMigrationLedger(owner, checks);
  await auditRoles(owner, checks);
  const rlsTables = await auditRls(owner, checks);
  await auditGrants(owner, checks);
  await auditFunctions(owner, checks);
  await auditImmutableTriggers(owner, checks);
  await auditFixtureState(owner);
  checks.push(
    "Fixture state: no live disposable identities/grants/submissions/invitations/notifications; retained histories untouched",
  );
  await auditCaptures(checks);
  await auditBrowserArtifacts(checks);
  return { checks, migrations, rlsTables };
}
