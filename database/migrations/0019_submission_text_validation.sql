-- Normalize whitespace for meaningful title/description validation at the SQL write boundary.
CREATE OR REPLACE FUNCTION app.save_draft(target uuid, expected integer, kind_value text, title_value text, category_value text, abstract_value text, tags text[], private_value boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result uuid; current_row app.submissions;
BEGIN
 PERFORM app.require_submission_account();
 IF kind_value IS NULL OR kind_value NOT IN ('document','idea') OR title_value IS NULL OR length(btrim(regexp_replace(title_value,'\s+',' ','g'))) NOT BETWEEN 1 AND 200
 OR category_value IS NULL OR category_value NOT IN ('Sermon / Homily','Research paper','Liturgy & worship','Pastoral care','Biblical studies','Church history','Ethics & society','Idea / Proposal','General')
 OR abstract_value IS NULL OR length(abstract_value)>20000 OR tags IS NULL OR cardinality(tags)>20
 OR EXISTS(SELECT 1 FROM unnest(tags) tag WHERE tag IS NULL OR length(btrim(tag)) NOT BETWEEN 1 AND 60) OR private_value IS NULL
 THEN RAISE EXCEPTION 'Invalid draft' USING ERRCODE='22023'; END IF;
 IF target IS NULL THEN
  IF expected IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Invalid version' USING ERRCODE='22023'; END IF;
  INSERT INTO app.submissions(owner_id,kind,title,category,abstract,keywords,confidential,status)
  VALUES(app.request_user_id(),kind_value::app.submission_kind,btrim(regexp_replace(title_value,'\s+',' ','g')),category_value,abstract_value,tags,private_value,'draft') RETURNING id INTO result;
 ELSE
  SELECT * INTO current_row FROM app.submissions WHERE id=target AND owner_id=app.request_user_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002'; END IF;
  IF current_row.version IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Draft conflict' USING ERRCODE='40001'; END IF;
  IF current_row.status::text<>'draft' OR current_row.kind::text<>kind_value THEN RAISE EXCEPTION 'Not editable' USING ERRCODE='22023'; END IF;
  UPDATE app.submissions SET title=btrim(regexp_replace(title_value,'\s+',' ','g')),category=category_value,abstract=abstract_value,keywords=tags,confidential=private_value,version=version+1 WHERE id=target;
  result:=target;
 END IF;
 PERFORM app.snapshot_submission(result,CASE WHEN target IS NULL THEN 'created' ELSE 'saved' END);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION app.transition_submission(target uuid, expected integer, transition text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_row app.submissions;
BEGIN
 PERFORM app.require_submission_account();
 SELECT * INTO current_row FROM app.submissions WHERE id=target AND owner_id=app.request_user_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002'; END IF;
 IF current_row.version IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Submission conflict' USING ERRCODE='40001'; END IF;
 IF transition='submit' AND current_row.status::text='draft' THEN
  IF (current_row.kind='idea' AND length(btrim(regexp_replace(current_row.abstract,'\s+',' ','g')))<20)
  OR (current_row.kind='document' AND (length(btrim(regexp_replace(current_row.abstract,'\s+',' ','g')))<20 OR NOT EXISTS(SELECT 1 FROM app.documents WHERE submission_id=target AND state='available' AND NOT excluded)
    OR EXISTS(SELECT 1 FROM app.documents WHERE submission_id=target AND state<>'available' AND NOT excluded)))
  THEN RAISE EXCEPTION 'Complete description and attachments required' USING ERRCODE='22023'; END IF;
  UPDATE app.submissions SET status='submitted',version=version+1,submitted_at=now() WHERE id=target;
 ELSIF transition='amend' AND current_row.status::text='returned' THEN
  PERFORM app.snapshot_submission(target,'amendment_started');
  UPDATE app.submissions SET status='draft',version=version+1,revision=revision+1 WHERE id=target;
 ELSE RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023'; END IF;
 PERFORM app.snapshot_submission(target,transition);
END $$;
