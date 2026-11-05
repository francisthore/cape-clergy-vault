# Historical Supabase reference — do not apply to local PostgreSQL

The schema stub, SQL and metadata in this directory are preserved unchanged.
They rely on Supabase-managed auth, storage, roles, RLS helpers and historical
migration state. They are not the new application migration chain.

The root drizzle.config.ts now reads database/schema/index.ts and writes only to
database/migrations. The guarded db:migrate command has a fixed path to that new
folder and does not read this directory or LOVABLE_DB_MIGRATION_URL. Do not point
a migration runner at this historical folder. No scripts in this phase run the
Supabase CLI or connect to a Supabase database.
