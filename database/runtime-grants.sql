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
GRANT INSERT (id, owner_id, sender_id, body) ON app.chat_messages TO cape_clergy_runtime;
GRANT INSERT (actor_id, target_user_id, submission_id, action, outcome, correlation_id) ON app.audit_events TO cape_clergy_runtime;
GRANT INSERT (user_id, notice_version, purpose, action) ON app.popia_consent_events TO cape_clergy_runtime;
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

REVOKE UPDATE(status) ON app.submissions FROM cape_clergy_runtime;
-- Phase 3E: no direct review writes, and no admin substitution for assignment.
REVOKE INSERT, UPDATE ON app.review_decisions, app.submissions FROM cape_clergy_runtime;
REVOKE INSERT(submission_id,reviewer_id,outcome,notes) ON app.review_decisions FROM cape_clergy_runtime;
GRANT EXECUTE ON FUNCTION app.can_review_submission(uuid) TO cape_clergy_runtime;
-- Operator/outbox/history tables carry credentials or administration evidence.
REVOKE ALL ON app.reviewer_invitations,app.reviewer_events,app.reviewer_notifications FROM cape_clergy_runtime;
GRANT EXECUTE ON FUNCTION app.inspect_reviewer_invitation(text),app.accept_reviewer_invitation(text),
 app.decide_review(uuid,integer,text,text,text,uuid),app.author_review_feedback(uuid),app.reviewer_author(uuid) TO cape_clergy_runtime;

GRANT EXECUTE ON FUNCTION app.assignment_notification_allowed(uuid) TO cape_clergy_runtime;
-- Scanner evidence is inaccessible to the web runtime; only a safe predicate is executable.
REVOKE ALL ON app.document_scans,app.document_scan_events FROM cape_clergy_runtime;
GRANT EXECUTE ON FUNCTION app.document_is_clean(uuid) TO cape_clergy_runtime;
