-- Custom migration: Drizzle does not model PostgreSQL triggers in its snapshots.
-- RLS is enabled in the generated migration; no application policies/grants yet.
REVOKE ALL ON SCHEMA app FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION app.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.reject_history_mutation() FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'audit_events', 'popia_consent_events', 'account_approval_events',
    'review_decisions', 'chat_messages'
  ] LOOP
    EXECUTE format('CREATE TRIGGER reject_row_mutation BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation()', table_name);
    EXECUTE format('CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON app.%I FOR EACH STATEMENT EXECUTE FUNCTION app.reject_history_mutation()', table_name);
  END LOOP;
END;
$$;
