-- Legacy objects have no scan evidence. Preserve bytes/metadata, withdraw ordinary access.
WITH legacy AS (UPDATE app.documents SET state='legacy_unscanned' WHERE state='available' RETURNING id,submission_id)
 INSERT INTO app.audit_events(document_id,submission_id,action,outcome,correlation_id)
 SELECT id,submission_id,'document.scan.legacy_quarantined','ok',gen_random_uuid() FROM legacy;
CREATE TRIGGER reject_row_mutation BEFORE UPDATE OR DELETE ON app.document_scan_events FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON app.document_scan_events FOR EACH STATEMENT EXECUTE FUNCTION app.reject_history_mutation();
CREATE FUNCTION app.document_is_clean(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.documents d JOIN app.document_scans j ON j.document_id=d.id
 WHERE d.id=doc AND d.state='available' AND j.state='clean' AND j.expected_sha256=d.sha256
 AND j.scanned_sha256=d.sha256 AND j.completed_at IS NOT NULL)
$$;
DROP POLICY document_read ON app.documents;
CREATE POLICY document_read ON app.documents FOR SELECT USING
 (app.document_account_allowed() AND EXISTS(SELECT 1 FROM app.submissions s WHERE s.id=documents.submission_id
 AND (s.owner_id=app.request_user_id() OR (app.document_is_clean(documents.id) AND NOT documents.excluded))));
CREATE OR REPLACE FUNCTION app.finalize_document(doc uuid,size bigint,checksum text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE parent uuid;
BEGIN
 SELECT d.submission_id INTO parent FROM app.documents d JOIN app.submissions s ON s.id=d.submission_id
 WHERE d.id=doc AND d.state='pending' AND NOT d.excluded AND s.owner_id=app.request_user_id()
 AND s.status::text='draft' AND s.kind='document' FOR SHARE OF s;
 IF parent IS NULL OR NOT app.document_account_allowed() THEN RAISE EXCEPTION 'Document authorization required' USING ERRCODE='42501'; END IF;
 IF size IS NULL OR size<=0 OR size>20971520 OR checksum IS NULL OR checksum !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'Invalid document metadata' USING ERRCODE='22023'; END IF;
 UPDATE app.documents SET state='quarantined',byte_size=size,sha256=checksum WHERE id=doc AND state='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'Document conflict' USING ERRCODE='23505'; END IF;
 INSERT INTO app.document_scans(document_id,expected_sha256) VALUES(doc,checksum);
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id)
 SELECT doc,0,'quarantined',correlation_id FROM app.document_scans WHERE document_id=doc;
 INSERT INTO app.audit_events(document_id,submission_id,action,outcome) VALUES(doc,parent,'document.scan.quarantined','ok');
END $$;
CREATE FUNCTION app.require_scanner_worker() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF session_user<>'cape_clergy_scanner' THEN RAISE EXCEPTION 'Scanner worker required' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION app.claim_document_scan(only_doc uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.document_scans; d app.documents; token uuid:=gen_random_uuid();
BEGIN
 PERFORM app.require_scanner_worker();
 -- Expired final attempts remain visibly exhausted; a crash never creates clean evidence.
 WITH exhausted AS (UPDATE app.document_scans SET state='exhausted',lease_token=NULL,lease_until=NULL,
 error_category='lease_exhausted',completed_at=now() WHERE state='scanning' AND lease_until<=now() AND attempts>=5
 RETURNING document_id,attempts,correlation_id)
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id)
 SELECT document_id,attempts,'lease_exhausted',correlation_id FROM exhausted;
 UPDATE app.documents SET state='scan_failed' WHERE state='scanning' AND id IN(SELECT document_id FROM app.document_scans WHERE state='exhausted');
 SELECT q.* INTO j FROM app.document_scans q JOIN app.documents x ON x.id=q.document_id
 WHERE (q.state='queued' AND q.available_at<=now() OR q.state='scanning' AND q.lease_until<=now())
 AND q.attempts<5 AND (only_doc IS NULL OR q.document_id=only_doc)
 AND x.state IN ('quarantined','scanning') ORDER BY q.available_at,q.document_id FOR UPDATE OF x,q SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE app.document_scans SET state='scanning',attempts=attempts+1,started_at=now(),completed_at=NULL,
 lease_token=token,lease_until=now()+interval '5 minutes',correlation_id=gen_random_uuid() WHERE document_id=j.document_id RETURNING * INTO j;
 UPDATE app.documents SET state='scanning' WHERE id=j.document_id RETURNING * INTO d;
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id) VALUES(d.id,j.attempts,'started',j.correlation_id);
 RETURN jsonb_build_object('documentId',d.id,'storageKey',d.storage_key,'sha256',j.expected_sha256,'byteSize',d.byte_size,
 'lease',token,'attempt',j.attempts,'correlationId',j.correlation_id);
END $$;
CREATE FUNCTION app.finish_document_scan(doc uuid,token uuid,verdict text,checksum text,engine_value text,definitions_value text,definitions_time timestamptz,error_value text)
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
 IF d.excluded OR s.kind<>'document' OR NOT app.document_account_allowed() THEN
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
-- Owner-only explicit legacy reconciliation queues evidence; it never marks anything clean.
CREATE FUNCTION app.queue_legacy_document_scan(doc uuid,confirmation text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d app.documents;
BEGIN
 IF session_user<>'cape_clergy_dev' OR confirmation IS DISTINCT FROM 'QUARANTINE '||doc::text THEN RAISE EXCEPTION 'Exact operator confirmation required' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM app.documents WHERE id=doc AND state='legacy_unscanned' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Legacy document unavailable' USING ERRCODE='22023'; END IF;
 UPDATE app.documents SET state='quarantined' WHERE id=doc;
 INSERT INTO app.document_scans(document_id,expected_sha256) VALUES(doc,d.sha256);
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id) VALUES(doc,0,'legacy_queued',gen_random_uuid());
 INSERT INTO app.audit_events(document_id,submission_id,action,outcome) VALUES(doc,d.submission_id,'document.scan.legacy_queued','ok');
END $$;
REVOKE ALL ON FUNCTION app.document_is_clean(uuid),app.require_scanner_worker(),app.claim_document_scan(uuid),
 app.finish_document_scan(uuid,uuid,text,text,text,text,timestamptz,text),app.queue_legacy_document_scan(uuid,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.record_document_access(doc uuid,event text,correlation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE parent uuid; allowed boolean;
BEGIN
 IF event IS NULL OR event NOT IN ('denied','unavailable','authorized','open_failed','started','transfer_failed','cancelled','stream_ended') OR correlation IS NULL
 THEN RAISE EXCEPTION 'Invalid audit event' USING ERRCODE='22023'; END IF;
 SELECT s.id,app.document_account_allowed() AND
 (s.owner_id=app.request_user_id() OR app.can_review_submission(s.id) OR (s.status='accepted' AND NOT s.confidential))
 AND app.document_is_clean(d.id) AND (NOT d.excluded OR s.owner_id=app.request_user_id()) INTO parent,allowed
 FROM app.documents d JOIN app.submissions s ON s.id=d.submission_id WHERE d.id=doc;
 IF event IN ('authorized','started') AND NOT coalesce(allowed,false) THEN
 RAISE EXCEPTION 'Document authorization required' USING ERRCODE='42501'; END IF;
 IF event='unavailable' AND parent IS NOT NULL AND NOT coalesce(allowed,false)
 AND EXISTS(SELECT 1 FROM app.documents WHERE id=doc AND state='available') THEN event:='denied'; END IF;
 INSERT INTO app.audit_events(actor_id,submission_id,document_id,action,outcome,correlation_id)
 VALUES(app.request_user_id(),parent,doc,'document.download.'||event,
 CASE WHEN event='denied' THEN 'denied'::app.audit_outcome WHEN event IN ('unavailable','open_failed','transfer_failed') THEN 'error'::app.audit_outcome ELSE 'ok'::app.audit_outcome END,correlation);
END $$;
