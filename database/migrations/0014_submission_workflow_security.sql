-- Author writes use fixed-purpose functions, not direct metadata UPDATE grants.
CREATE FUNCTION app.require_submission_account() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT app.document_account_allowed() THEN RAISE EXCEPTION 'Eligible account required' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION app.snapshot_submission(target uuid, event_name text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 INSERT INTO app.submission_events(submission_id,actor_id,event,version,revision,title,category,abstract,keywords,confidential,document_ids)
 SELECT id,app.request_user_id(),event_name,version,revision,title,category,abstract,keywords,confidential,
 ARRAY(SELECT d.id FROM app.documents d WHERE d.submission_id=s.id AND NOT d.excluded AND d.state='available' ORDER BY d.id)
 FROM app.submissions s WHERE id=target;
 INSERT INTO app.audit_events(actor_id,submission_id,action,outcome) VALUES(app.request_user_id(),target,'submission.'||event_name,'ok');
$$;
CREATE FUNCTION app.save_draft(target uuid, expected integer, kind_value text, title_value text, category_value text, abstract_value text, tags text[], private_value boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result uuid; current_row app.submissions;
BEGIN
 PERFORM app.require_submission_account();
 IF kind_value IS NULL OR kind_value NOT IN ('document','idea') OR title_value IS NULL OR length(btrim(title_value)) NOT BETWEEN 1 AND 200
 OR category_value IS NULL OR category_value NOT IN ('Sermon / Homily','Research paper','Liturgy & worship','Pastoral care','Biblical studies','Church history','Ethics & society','Idea / Proposal','General')
 OR abstract_value IS NULL OR length(abstract_value)>20000 OR tags IS NULL OR cardinality(tags)>20
 OR EXISTS(SELECT 1 FROM unnest(tags) tag WHERE tag IS NULL OR length(btrim(tag)) NOT BETWEEN 1 AND 60) OR private_value IS NULL
 THEN RAISE EXCEPTION 'Invalid draft' USING ERRCODE='22023'; END IF;
 IF target IS NULL THEN
  IF expected IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Invalid version' USING ERRCODE='22023'; END IF;
  INSERT INTO app.submissions(owner_id,kind,title,category,abstract,keywords,confidential,status)
  VALUES(app.request_user_id(),kind_value::app.submission_kind,btrim(title_value),category_value,abstract_value,tags,private_value,'draft') RETURNING id INTO result;
 ELSE
  SELECT * INTO current_row FROM app.submissions WHERE id=target AND owner_id=app.request_user_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002'; END IF;
  IF current_row.version IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Draft conflict' USING ERRCODE='40001'; END IF;
  IF current_row.status::text<>'draft' OR current_row.kind::text<>kind_value THEN RAISE EXCEPTION 'Not editable' USING ERRCODE='22023'; END IF;
  UPDATE app.submissions SET title=btrim(title_value),category=category_value,abstract=abstract_value,keywords=tags,confidential=private_value,version=version+1 WHERE id=target;
  result:=target;
 END IF;
 PERFORM app.snapshot_submission(result,CASE WHEN target IS NULL THEN 'created' ELSE 'saved' END);
 RETURN result;
END $$;
CREATE FUNCTION app.transition_submission(target uuid, expected integer, transition text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_row app.submissions;
BEGIN
 PERFORM app.require_submission_account();
 SELECT * INTO current_row FROM app.submissions WHERE id=target AND owner_id=app.request_user_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002'; END IF;
 IF current_row.version IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Submission conflict' USING ERRCODE='40001'; END IF;
 IF transition='submit' AND current_row.status::text='draft' THEN
  IF (current_row.kind='idea' AND length(btrim(current_row.abstract))<20)
  OR (current_row.kind='document' AND (length(btrim(current_row.abstract))<20 OR NOT EXISTS(SELECT 1 FROM app.documents WHERE submission_id=target AND state='available' AND NOT excluded)
    OR EXISTS(SELECT 1 FROM app.documents WHERE submission_id=target AND state<>'available' AND NOT excluded)))
  THEN RAISE EXCEPTION 'Complete description and attachments required' USING ERRCODE='22023'; END IF;
  UPDATE app.submissions SET status='submitted',version=version+1,submitted_at=now() WHERE id=target;
 ELSIF transition='amend' AND current_row.status::text='returned' THEN
  PERFORM app.snapshot_submission(target,'amendment_started');
  UPDATE app.submissions SET status='draft',version=version+1,revision=revision+1 WHERE id=target;
 ELSE RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023'; END IF;
 PERFORM app.snapshot_submission(target,transition);
END $$;
--> statement-breakpoint
CREATE POLICY submission_events_read ON app.submission_events FOR SELECT USING
 (app.document_account_allowed() AND EXISTS(SELECT 1 FROM app.submissions s WHERE s.id=submission_id AND s.owner_id=app.request_user_id()));
CREATE TRIGGER reject_row_mutation BEFORE UPDATE OR DELETE ON app.submission_events FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON app.submission_events FOR EACH STATEMENT EXECUTE FUNCTION app.reject_history_mutation();
DROP POLICY submission_create ON app.submissions;
-- No direct author INSERT: ids, ownership, state, versions and events are server generated.
DROP POLICY submission_read ON app.submissions;
CREATE POLICY submission_read ON app.submissions FOR SELECT USING
 (app.document_account_allowed() AND (owner_id=app.request_user_id() OR app.is_reviewer() OR (status::text='accepted' AND NOT confidential)));
DROP POLICY document_create ON app.documents;
CREATE POLICY document_create ON app.documents FOR INSERT WITH CHECK
 (app.document_account_allowed() AND state='pending' AND NOT excluded AND byte_size=0 AND sha256 IS NULL
 AND storage_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 AND media_type='application/pdf' AND EXISTS(SELECT 1 FROM app.submissions s WHERE s.id=submission_id
 AND s.owner_id=app.request_user_id() AND s.status::text='draft' AND s.kind='document'));
-- Serialize document reservation with final submission, without spanning network I/O.
CREATE FUNCTION app.lock_document_parent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 -- Migration-owner fixture/recovery tooling remains trusted; web runtime never uses that login.
 IF session_user='cape_clergy_dev' THEN RETURN NEW; END IF;
 PERFORM app.require_submission_account();
 PERFORM 1 FROM app.submissions WHERE id=NEW.submission_id AND owner_id=app.request_user_id() AND status::text='draft' AND kind='document' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Draft ownership required' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_reservation_lock BEFORE INSERT ON app.documents FOR EACH ROW EXECUTE FUNCTION app.lock_document_parent();
CREATE FUNCTION app.exclude_draft_document(doc uuid, expected integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE parent app.submissions;
BEGIN
 PERFORM app.require_submission_account();
 SELECT s.* INTO parent FROM app.submissions s JOIN app.documents d ON d.submission_id=s.id WHERE d.id=doc AND s.owner_id=app.request_user_id() FOR UPDATE OF s;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002'; END IF;
 IF parent.version IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Conflict' USING ERRCODE='40001'; END IF;
 IF parent.status::text<>'draft' THEN RAISE EXCEPTION 'Not editable' USING ERRCODE='22023'; END IF;
 UPDATE app.documents SET excluded=true WHERE id=doc AND state<>'pending' AND NOT excluded;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pending or already excluded' USING ERRCODE='22023'; END IF;
 UPDATE app.submissions SET version=version+1 WHERE id=parent.id;
 PERFORM app.snapshot_submission(parent.id,'attachment_excluded');
END $$;
DROP POLICY document_read ON app.documents;
CREATE POLICY document_read ON app.documents FOR SELECT USING
 (app.document_account_allowed() AND EXISTS(SELECT 1 FROM app.submissions s WHERE s.id=submission_id
 AND (s.owner_id=app.request_user_id() OR (state='available' AND NOT excluded))));
REVOKE ALL ON FUNCTION app.require_submission_account(),app.snapshot_submission(uuid,text),app.save_draft(uuid,integer,text,text,text,text,text[],boolean),
 app.transition_submission(uuid,integer,text),app.lock_document_parent(),app.exclude_draft_document(uuid,integer) FROM PUBLIC;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.finalize_document(doc uuid, size bigint, checksum text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE parent uuid;
BEGIN
 SELECT d.submission_id INTO parent FROM app.documents d
 JOIN app.submissions s ON s.id=d.submission_id
 WHERE d.id=doc AND d.state='pending' AND NOT d.excluded AND s.owner_id=app.request_user_id()
 AND s.status::text='draft' AND s.kind='document' FOR SHARE OF s;
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

CREATE OR REPLACE FUNCTION app.record_document_access(doc uuid, event text, correlation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE parent uuid; allowed boolean;
BEGIN
 IF event NOT IN ('denied','unavailable','authorized','open_failed','started','transfer_failed','cancelled','stream_ended')
 OR correlation IS NULL THEN RAISE EXCEPTION 'Invalid audit event' USING ERRCODE='22023'; END IF;
 SELECT s.id, app.document_account_allowed() AND
 (s.owner_id=app.request_user_id() OR app.is_reviewer() OR (s.status='accepted' AND NOT s.confidential))
 AND d.state='available' AND (NOT d.excluded OR s.owner_id=app.request_user_id()) INTO parent,allowed
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
