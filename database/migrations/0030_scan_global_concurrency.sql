-- Global limit across separate worker processes, in addition to per-process bounds.
ALTER FUNCTION app.claim_document_scan(uuid) RENAME TO claim_document_scan_internal;
CREATE FUNCTION app.claim_document_scan(only_doc uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app.require_scanner_worker();
 IF NOT pg_try_advisory_xact_lock(313006,1) THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM app.document_scans WHERE state='scanning' AND lease_until>now())>=2 THEN RETURN NULL; END IF;
 RETURN app.claim_document_scan_internal(only_doc);
END $$;
REVOKE ALL ON FUNCTION app.claim_document_scan(uuid),app.claim_document_scan_internal(uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cape_clergy_scanner') THEN
 REVOKE ALL ON FUNCTION app.claim_document_scan_internal(uuid) FROM cape_clergy_scanner;
 GRANT EXECUTE ON FUNCTION app.claim_document_scan(uuid) TO cape_clergy_scanner;
END IF; END $$;
