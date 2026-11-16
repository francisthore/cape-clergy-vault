// Read-only test tooling. Retained evidence is not a failed cleanup or an allowlisted exception.
import assert from "node:assert/strict";
import type { Sql, TransactionSql } from "postgres";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const fixtureIdentityPattern = `^(phase3[a-f]|phase4|p3e-boundary|p3f-scan|p3f-notice|p41b|p42|p42-browser|browser-p3f|smoke3[a-d]|smoke3b-target)-${uuid}(-[a-z0-9]+)*$`;
const fixtureEmailPattern = fixtureIdentityPattern.slice(0, -1) + "@example\\.invalid$";

export const appendOnlyTables = [
  "audit_events",
  "popia_consent_events",
  "account_approval_events",
  "review_decisions",
  "reviewer_events",
  "submission_events",
  "document_scan_events",
  "chat_messages",
  "email_settings_history",
  "email_test_attempts",
] as const;
export function assertNoLiveFixtures(counts: Record<string, unknown>) {
  assert.ok(Object.keys(counts).length > 0, "Fixture inspection must return counts");
  for (const [kind, count] of Object.entries(counts))
    assert.equal(count, 0, `Live disposable fixture remains: ${kind}`);
}
export async function auditFixtureState(db: Sql | TransactionSql) {
  const [live] = await db`
    with fixture_users as (
      select id from auth.users where id ~ ${fixtureIdentityPattern} or email ~ ${fixtureEmailPattern}
    ), fixture_submissions as (
      select id from app.submissions where owner_id in(select id from fixture_users) or owner_id ~ ${fixtureIdentityPattern}
    ) select
      (select count(*)::int from fixture_users) as identities,
      (select count(*)::int from app.clergy_profiles where user_id in(select id from fixture_users) or user_id ~ ${fixtureIdentityPattern}) as profiles,
      (select count(*)::int from app.role_assignments where revoked_at is null and (user_id in(select id from fixture_users) or user_id ~ ${fixtureIdentityPattern})) as active_grants,
      (select count(*)::int from fixture_submissions) as submissions,
      (select count(*)::int from app.documents where submission_id in(select id from fixture_submissions)) as documents,
      (select count(*)::int from app.reviewer_invitations where state='pending' and (user_id in(select id from fixture_users) or user_id ~ ${fixtureIdentityPattern})) as pending_invitations,
      (select count(*)::int from app.reviewer_assignments where status='active' and (reviewer_id in(select id from fixture_users) or reviewer_id ~ ${fixtureIdentityPattern} or submission_id in(select id from fixture_submissions))) as active_assignments,
      (select count(*)::int from app.reviewer_notifications where delivered_at is null and cancelled_at is null and (user_id in(select id from fixture_users) or user_id ~ ${fixtureIdentityPattern} or submission_id in(select id from fixture_submissions))) as pending_notifications`;
  assert.ok(live, "Fixture inspection returned a row");
  assertNoLiveFixtures(live);

  // Require the actual enforcement triggers, not merely an absence of disabled triggers.
  const triggers = await db`select c.relname as table_name,t.tgname,t.tgenabled,t.tgtype,
    t.tgfoid='app.reject_history_mutation()'::regprocedure as correct_function
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='app' and c.relname=any(${[...appendOnlyTables]}) and not t.tgisinternal`;
  const unsafeGrants = await db`select c.relname,r.rolname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace cross join pg_roles r
    where n.nspname='app' and c.relname=any(${[...appendOnlyTables]})
    and r.rolname in ('cape_clergy_runtime','cape_clergy_scanner','cape_clergy_notifications')
    and (has_table_privilege(r.rolname,c.oid,'DELETE') or has_table_privilege(r.rolname,c.oid,'TRUNCATE')
      or has_any_column_privilege(r.rolname,c.oid,'UPDATE'))`;
  assert.equal(unsafeGrants.length, 0, "Application/worker roles cannot mutate retained histories");
  const retained: Record<string, number> = {};
  for (const table of appendOnlyTables) {
    for (const [name, type] of [
      ["reject_row_mutation", 27],
      ["reject_truncate", 34],
    ] as const) {
      const matches = triggers.filter((t) => t["table_name"] === table && t["tgname"] === name);
      assert.equal(matches.length, 1, `${table} must retain ${name}`);
      const trigger = matches[0]!;
      assert.ok(
        ["O", "A"].includes(String(trigger["tgenabled"])),
        `${table}.${name} must enforce ordinary writes`,
      );
      assert.equal(trigger["correct_function"], true, `${table}.${name} must reject mutation`);
      assert.equal(trigger["tgtype"], type, `${table}.${name} must cover the original events`);
    }
    const [count] = await db`select count(*)::int as n from app.${db(table)}`;
    retained[table] = Number(count!["n"]);
  }
  // No prefix/action/ID exemptions for history and no expectation that its count is zero.
  console.log(
    JSON.stringify({ event: "audit.fixture_state", liveFixtures: live, retainedHistory: retained }),
  );
  return { liveFixtures: live, retainedHistory: retained };
}
