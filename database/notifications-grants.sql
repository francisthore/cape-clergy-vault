REVOKE ALL ON DATABASE cape_clergy_vault_dev FROM cape_clergy_notifications;
GRANT CONNECT ON DATABASE cape_clergy_vault_dev TO cape_clergy_notifications;
REVOKE ALL ON SCHEMA public,app,auth,cape_migrations FROM cape_clergy_notifications;
GRANT USAGE ON SCHEMA app TO cape_clergy_notifications;
REVOKE ALL ON ALL TABLES IN SCHEMA app,auth,cape_migrations FROM cape_clergy_notifications;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app,auth,cape_migrations FROM cape_clergy_notifications;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM cape_clergy_notifications;
GRANT EXECUTE ON FUNCTION app.claim_notification(text,uuid,uuid),app.check_notification(text,uuid,uuid),app.prepare_notification(text,uuid,uuid,text,text),app.finish_notification(text,uuid,uuid,boolean),app.resolve_email_settings() TO cape_clergy_notifications;
