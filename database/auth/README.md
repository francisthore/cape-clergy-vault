# Authentication schema boundary

Reserved for a future Better Auth CLI-generated Drizzle schema. Phase 2A deliberately
contains no auth tables, adapter, registration routes, session handling or dependency.

The application uses opaque **text** user IDs matching Better Auth's default string
IDs. Keep that configuration when generating auth tables; do not enable serial IDs
or change application columns to PostgreSQL UUID. UUID-looking legacy Supabase IDs
can be represented as text, but no import or identity matching is performed here.

In Phase 2B, pin the selected Better Auth version, decide its plugins, generate its
schema into this directory, and review it before including it in Drizzle's schema
entrypoint. Keep auth tables in a separate PostgreSQL `auth` namespace (with the
adapter explicitly mapped to generated tables), then add the FK from
`app.clergy_profiles.user_id` to the generated user table's **text** primary key.
Validate namespace/adapter compatibility against the pinned version. Do not create
auth tables or a placeholder auth user table by hand.

Application FKs currently reference clergy_profiles with text IDs. This is an
application profile root, not an authentication authority; it cannot prove an
identity until the generated auth FK and provisioning transaction exist.

References: [Better Auth database concepts](https://better-auth.com/docs/concepts/database),
[Drizzle adapter](https://better-auth.com/docs/adapters/drizzle).
