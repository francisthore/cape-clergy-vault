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

-- Approval administration uses fixed-purpose functions, never direct table mutation.
REVOKE ALL ON app.approval_notifications, app.approver_bootstrap FROM cape_clergy_runtime;
GRANT EXECUTE ON FUNCTION app.is_approver(), app.require_approver(),
 app.registration_list(text,text,integer), app.registration_detail(text),
 app.decide_registration(text,text,text,uuid) TO cape_clergy_runtime;

-- Phase 3C: RLS reserves pending documents; only constrained functions finalize/fail.
GRANT EXECUTE ON FUNCTION app.document_account_allowed(),app.finalize_document(uuid,bigint,text),
 app.fail_document(uuid),app.record_document_access(uuid,text,uuid) TO cape_clergy_runtime;

-- Phase 3D settings: non-secret resolver and narrow capability-bound functions.
REVOKE ALL ON app.settings_managers,app.email_test_attempts FROM cape_clergy_runtime;
GRANT EXECUTE ON FUNCTION app.is_settings_manager(),app.require_settings_manager(),app.resolve_email_settings(),
 app.save_email_settings(integer,text,text,text,text,boolean,boolean),app.reserve_email_test() TO cape_clergy_runtime;

-- Phase 3D author metadata writes only through scoped, version-checked functions.
REVOKE INSERT ON app.submissions FROM cape_clergy_runtime;
GRANT EXECUTE ON FUNCTION app.require_submission_account(),app.save_draft(uuid,integer,text,text,text,text,text[],boolean),
 app.transition_submission(uuid,integer,text),app.exclude_draft_document(uuid,integer) TO cape_clergy_runtime;
