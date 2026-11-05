-- Local filesystem objects use opaque UUID keys. No legacy object is promoted.
-- Existing rows remain pending until explicitly reconciled by trusted tooling.
CREATE FUNCTION app.document_account_allowed() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
 SELECT app.has_consent('repository') AND EXISTS
 (SELECT 1 FROM auth.users WHERE id=app.request_user_id() AND email_verified)
$$;
--> statement-breakpoint
DROP POLICY document_read ON app.documents;
CREATE POLICY document_read ON app.documents FOR SELECT USING
 (app.document_account_allowed() AND EXISTS
 (SELECT 1 FROM app.submissions s WHERE s.id=submission_id
 AND (state='available' OR s.owner_id=app.request_user_id())));
DROP POLICY document_create ON app.documents;
CREATE POLICY document_create ON app.documents FOR INSERT WITH CHECK
 (app.document_account_allowed() AND state='pending' AND byte_size=0 AND sha256 IS NULL
 AND storage_key=id::text AND media_type='application/pdf'
 AND EXISTS (SELECT 1 FROM app.submissions s WHERE s.id=submission_id
 AND s.owner_id=app.request_user_id() AND s.status='submitted' AND s.kind='document'));
--> statement-breakpoint
-- Short finalization transaction: locks the parent against review/status changes.
CREATE FUNCTION app.finalize_document(doc uuid, size bigint, checksum text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE parent uuid;
BEGIN
 SELECT d.submission_id INTO parent FROM app.documents d
 JOIN app.submissions s ON s.id=d.submission_id
 WHERE d.id=doc AND d.state='pending' AND s.owner_id=app.request_user_id()
 AND s.status='submitted' AND s.kind='document' FOR SHARE OF s;
 IF parent IS NULL OR NOT app.document_account_allowed() THEN
  RAISE EXCEPTION 'Document authorization required' USING ERRCODE='42501';
 END IF;
 IF size<=0 OR size>20971520 OR checksum IS NULL OR checksum !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'Invalid document metadata' USING ERRCODE='22023';
 END IF;
 UPDATE app.documents SET state='available',byte_size=size,sha256=checksum
 WHERE id=doc AND state='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'Document conflict' USING ERRCODE='23505'; END IF;
END $$;
--> statement-breakpoint
-- Recovery may run after consent/approval changes. Only the authenticated owner
-- can fail their pending row; available rows are never demoted after an ambiguous commit.
CREATE FUNCTION app.fail_document(doc uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
DECLARE result text;
BEGIN
 PERFORM 1 FROM app.documents d JOIN app.submissions s ON s.id=d.submission_id
 WHERE d.id=doc AND s.owner_id=app.request_user_id() FOR UPDATE OF d;
 IF NOT FOUND THEN RAISE EXCEPTION 'Document authorization required' USING ERRCODE='42501'; END IF;
 UPDATE app.documents SET state='failed' WHERE id=doc AND state='pending';
 SELECT state INTO result FROM app.documents WHERE id=doc;
 RETURN result;
END $$;
--> statement-breakpoint
-- Narrow audit append for anonymous/inactive/denied requests, not general audit INSERT.
-- Identity comes from the trusted session boundary; no actor or outcome parameter.
CREATE FUNCTION app.record_document_access(doc uuid, event text, correlation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE parent uuid; allowed boolean;
BEGIN
 IF event NOT IN ('denied','unavailable','authorized','open_failed','started','transfer_failed','cancelled','stream_ended')
 OR correlation IS NULL THEN RAISE EXCEPTION 'Invalid audit event' USING ERRCODE='22023'; END IF;
 SELECT s.id, app.document_account_allowed() AND
 (s.owner_id=app.request_user_id() OR app.is_reviewer() OR (s.status='accepted' AND NOT s.confidential))
 AND d.state='available' INTO parent,allowed
 FROM app.documents d JOIN app.submissions s ON s.id=d.submission_id WHERE d.id=doc;
 IF event IN ('authorized','started') AND NOT coalesce(allowed,false) THEN
  RAISE EXCEPTION 'Document authorization required' USING ERRCODE='42501';
 END IF;
 -- Hidden existing rows are a rejected lookup; the client always gets the same 404.
 IF event='unavailable' AND parent IS NOT NULL AND NOT coalesce(allowed,false)
 AND EXISTS(SELECT 1 FROM app.documents WHERE id=doc AND state='available') THEN event := 'denied'; END IF;
 INSERT INTO app.audit_events(actor_id,submission_id,document_id,action,outcome,correlation_id)
 VALUES(app.request_user_id(),parent,doc,'document.download.'||event,
 CASE WHEN event='denied' THEN 'denied'::app.audit_outcome
 WHEN event IN ('unavailable','open_failed','transfer_failed') THEN 'error'::app.audit_outcome
 ELSE 'ok'::app.audit_outcome END,correlation);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.document_account_allowed(), app.finalize_document(uuid,bigint,text),
 app.fail_document(uuid),app.record_document_access(uuid,text,uuid) FROM PUBLIC;
