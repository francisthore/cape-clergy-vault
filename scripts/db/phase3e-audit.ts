import assert from "node:assert/strict";
import { auditFixtureState } from "../../database/test-fixture-audit.ts";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { connectLocalDatabase } from "../../database/connection.server.ts";
const owner = await connectLocalDatabase();
try {
  const files = (await readdir("database/migrations")).filter((f) => f.endsWith(".sql"));
  const hashes = await Promise.all(
    files.map(async (f) =>
      createHash("sha256")
        .update(await readFile(join("database/migrations", f)))
        .digest("hex"),
    ),
  );
  const ledger = await owner.client`select hash from cape_migrations.__drizzle_migrations`;
  assert.equal(ledger.length, 36);
  assert.deepEqual(new Set(ledger.map((r) => r["hash"])), new Set(hashes));
  const [grants] =
    await owner.client`select has_any_column_privilege('cape_clergy_runtime','app.submissions','UPDATE') as status_write,
 has_any_column_privilege('cape_clergy_runtime','app.review_decisions','INSERT') as history_write,
 has_table_privilege('cape_clergy_runtime','app.reviewer_invitations','SELECT') as invites,
 has_table_privilege('cape_clergy_runtime','app.reviewer_events','SELECT') as events,
 has_table_privilege('cape_clergy_runtime','app.reviewer_notifications','SELECT') as outbox`;
  assert.ok(grants && Object.values(grants).every((v) => v === false));
  const forbidden =
    await owner.client`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app' and p.proname in ('reviewer_operator','reviewer_operator_internal','reviewer_operator_event','invalidate_reviewer_invitation','snapshot_submission','notification_eligible','notification_eligible_before_phase42','queue_registration_received','require_notification_worker')
 and has_function_privilege('cape_clergy_runtime',p.oid,'EXECUTE')`;
  assert.equal(forbidden.length, 0);
  const publicFunctions =
    await owner.client`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
 lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where n.nspname='app' and a.grantee=0 and a.privilege_type='EXECUTE'`;
  assert.equal(publicFunctions.length, 0);
  const [rls] =
    await owner.client`select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r' and c.relrowsecurity`;
  assert.equal(rls!["n"], 26);
  const disabled =
    await owner.client`select t.oid from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and not t.tgisinternal and t.tgenabled='D'`;
  assert.equal(disabled.length, 0);
  await auditFixtureState(owner.client);
  const secrets = [
    "BETTER_AUTH_SECRET",
    "RESEND_API_KEY",
    "BOUNCER_API_KEY",
    "CAPE_RUNTIME_DATABASE_URL",
    "CAPE_DATABASE_URL",
    "CAPE_NOTIFICATION_DATABASE_URL",
  ]
    .map((k) => process.env[k])
    .filter((s): s is string => !!s && s.length >= 8);
  for (const k of ["CAPE_RUNTIME_DATABASE_URL", "CAPE_DATABASE_URL"]) {
    const value = process.env[k];
    if (value) secrets.push(decodeURIComponent(new URL(value).password));
  }
  let artifacts = 0;
  async function scan(path: string) {
    for (const file of await readdir(path, { withFileTypes: true })) {
      const p = join(path, file.name);
      if (file.isDirectory()) await scan(p);
      else if (/\.(js|mjs|html|json|map)$/.test(file.name)) {
        const content = await readFile(p, "utf8");
        assert.ok(
          secrets.every((s) => !content.includes(s)),
          "No configured private credential in browser artifacts",
        );
        artifacts++;
      }
    }
  }
  await scan(".output/public");
  assert.ok(artifacts > 0, "Build browser artifacts before running this audit");
  console.log(
    `PASS: ${ledger.length} migration hashes, 26 RLS tables, reviewed grants/functions, enabled immutable triggers, no live disposable fixtures, preserved append-only evidence and ${artifacts} public artifacts without configured private credentials.`,
  );
} finally {
  await owner.close();
}
