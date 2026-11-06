-- Retain a verified infected verdict even when the author loses eligibility or excludes
-- the attachment during scanning. Eligibility can only prevent promotion, never erase detection evidence.
CREATE OR REPLACE FUNCTION app.finish_document_scan(doc uuid,token uuid,verdict text,checksum text,engine_value text,definitions_value text,definitions_time timestamptz,error_value text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.document_scans; d app.documents; s app.submissions; event_name text;
BEGIN
 PERFORM app.require_scanner_worker();
 SELECT p.* INTO s FROM app.submissions p JOIN app.documents x ON x.submission_id=p.id WHERE x.id=doc FOR SHARE OF p;
 SELECT * INTO d FROM app.documents WHERE id=doc FOR UPDATE;
 SELECT * INTO j FROM app.document_scans WHERE document_id=doc FOR UPDATE;
 IF j.document_id IS NULL OR j.state<>'scanning' OR j.lease_token IS DISTINCT FROM token OR j.lease_until<=now() THEN RETURN false; END IF;
 IF verdict IS NULL OR verdict NOT IN ('clean','infected','error','unavailable') THEN verdict:='error'; error_value:='invalid_response'; END IF;
 IF error_value IS NOT NULL AND error_value NOT IN ('unavailable','timeout','disconnected','invalid_response','size_limit','definitions_missing','definitions_stale','integrity_mismatch','object_missing','storage_error','scanner_error','ineligible')
 THEN error_value:='scanner_error'; END IF;
 IF verdict IN ('clean','infected') AND (checksum IS DISTINCT FROM j.expected_sha256 OR checksum IS DISTINCT FROM d.sha256 OR d.state<>'scanning')
 THEN verdict:='error';error_value:='integrity_mismatch'; END IF;
 IF verdict='clean' AND (engine_value IS NULL OR length(engine_value) NOT BETWEEN 1 AND 128 OR definitions_value IS NULL OR length(definitions_value) NOT BETWEEN 1 AND 64
 OR definitions_time IS NULL OR definitions_time<now()-interval '72 hours' OR definitions_time>now()+interval '5 minutes')
 THEN verdict:='error';error_value:='definitions_stale'; END IF;
 -- Recheck live author eligibility after scanner I/O; the worker cannot choose the actor.
 PERFORM set_config('cape.user_id',s.owner_id,true);
 IF verdict<>'infected' AND (d.excluded OR s.kind<>'document' OR NOT app.document_account_allowed()) THEN
  verdict:='cancelled';error_value:='ineligible';
 END IF;
 event_name:=verdict;
 IF verdict='clean' THEN
  UPDATE app.documents SET state='available' WHERE id=doc AND state='scanning';
 ELSIF verdict='infected' THEN
  UPDATE app.documents SET state='infected' WHERE id=doc;
 ELSIF verdict='cancelled' OR j.attempts>=5 OR error_value IN ('integrity_mismatch','object_missing','size_limit') THEN
  UPDATE app.documents SET state='scan_failed' WHERE id=doc;
  IF verdict<>'cancelled' THEN verdict:='exhausted'; END IF;
 ELSE
  UPDATE app.documents SET state='quarantined' WHERE id=doc;
  verdict:='queued';
 END IF;
 UPDATE app.document_scans SET state=verdict,scanned_sha256=CASE WHEN checksum ~ '^[0-9a-f]{64}$' THEN checksum ELSE NULL END,
 engine=left(engine_value,128),definitions_version=left(definitions_value,64),definitions_at=definitions_time,
 error_category=error_value,completed_at=now(),lease_token=NULL,lease_until=NULL,
 available_at=now()+least(3600,30*power(2,attempts))*interval '1 second' WHERE document_id=doc;
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id) VALUES(doc,j.attempts,event_name,j.correlation_id);
 INSERT INTO app.audit_events(document_id,submission_id,action,outcome,correlation_id)
 VALUES(doc,d.submission_id,'document.scan.'||event_name,CASE WHEN event_name='clean' THEN 'ok'::app.audit_outcome ELSE 'error'::app.audit_outcome END,j.correlation_id);
 RETURN true;
END $$;
