REVOKE ALL ON DATABASE cape_clergy_vault_dev FROM cape_clergy_scanner;
GRANT CONNECT ON DATABASE cape_clergy_vault_dev TO cape_clergy_scanner;
REVOKE ALL ON SCHEMA public,app,auth,cape_migrations FROM cape_clergy_scanner;
GRANT USAGE ON SCHEMA app TO cape_clergy_scanner;
REVOKE ALL ON ALL TABLES IN SCHEMA app,auth,cape_migrations FROM cape_clergy_scanner;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app,auth,cape_migrations FROM cape_clergy_scanner;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM cape_clergy_scanner;
GRANT EXECUTE ON FUNCTION app.claim_document_scan(uuid),app.finish_document_scan(uuid,uuid,text,text,text,text,timestamptz,text) TO cape_clergy_scanner;
