-- Applied by guarded local owner tooling AFTER migrations; never by runtime.
REVOKE ALL ON DATABASE cape_clergy_vault_dev FROM cape_clergy_runtime;
GRANT CONNECT ON DATABASE cape_clergy_vault_dev TO cape_clergy_runtime;
REVOKE ALL ON SCHEMA public, app, auth, cape_migrations FROM cape_clergy_runtime;
GRANT USAGE ON SCHEMA app, auth TO cape_clergy_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA app, auth, cape_migrations FROM cape_clergy_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app, auth, cape_migrations FROM cape_clergy_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO cape_clergy_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO cape_clergy_runtime;
GRANT INSERT ON app.submissions, app.documents, app.chat_notification_preferences TO cape_clergy_runtime;
GRANT INSERT (submission_id, reviewer_id, outcome, notes) ON app.review_decisions TO cape_clergy_runtime;
GRANT INSERT (id, owner_id, sender_id, body) ON app.chat_messages TO cape_clergy_runtime;
GRANT INSERT (actor_id, target_user_id, submission_id, action, outcome, correlation_id) ON app.audit_events TO cape_clergy_runtime;
GRANT INSERT (user_id, notice_version, purpose, action) ON app.popia_consent_events TO cape_clergy_runtime;
GRANT UPDATE (status) ON app.submissions TO cape_clergy_runtime;
GRANT UPDATE (muted) ON app.chat_notification_preferences TO cape_clergy_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA app TO cape_clergy_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM cape_clergy_runtime;
GRANT EXECUTE ON FUNCTION app.request_user_id(), app.is_active(), app.is_reviewer(),
  app.is_admin(), app.has_consent(text), app.can_chat(text) TO cape_clergy_runtime;
-- PostgreSQL otherwise grants function execution to PUBLIC by default.
ALTER DEFAULT PRIVILEGES FOR ROLE cape_clergy_dev REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- New tables/functions require an explicit reviewed grant.
GRANT EXECUTE ON FUNCTION app.provision_clergy(text,text,text,text,text,boolean,text) TO cape_clergy_runtime;
