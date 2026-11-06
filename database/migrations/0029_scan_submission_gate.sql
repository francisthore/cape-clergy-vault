-- Extend existing version-checked author transition without duplicating its lifecycle implementation.
ALTER FUNCTION app.transition_submission(uuid,integer,text) RENAME TO transition_submission_before_scan;
CREATE FUNCTION app.transition_submission(target uuid,expected integer,transition text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app.require_submission_account();
 PERFORM 1 FROM app.submissions WHERE id=target AND owner_id=app.request_user_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002'; END IF;
 IF transition='submit' AND EXISTS(SELECT 1 FROM app.documents WHERE submission_id=target AND NOT excluded AND NOT app.document_is_clean(id))
 THEN RAISE EXCEPTION 'Attachments must pass security checks' USING ERRCODE='22023'; END IF;
 PERFORM app.transition_submission_before_scan(target,expected,transition);
END $$;
REVOKE ALL ON FUNCTION app.transition_submission_before_scan(uuid,integer,text),app.transition_submission(uuid,integer,text) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cape_clergy_runtime') THEN
 REVOKE ALL ON FUNCTION app.transition_submission_before_scan(uuid,integer,text) FROM cape_clergy_runtime;
 GRANT EXECUTE ON FUNCTION app.transition_submission(uuid,integer,text) TO cape_clergy_runtime;
END IF; END $$;
