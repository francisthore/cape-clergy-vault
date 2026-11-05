-- Operator evidence is distinct from application actors. No invented clergy identity.
CREATE FUNCTION app.reviewer_operator_event(who text, invitation uuid, assignment uuid, event text, correlation uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 INSERT INTO app.reviewer_events(reviewer_id,invitation_id,assignment_id,operator,action,correlation_id)
 VALUES(who,invitation,assignment,session_user,event,correlation);
 INSERT INTO app.audit_events(target_user_id,action,outcome,correlation_id)
 VALUES(who,'reviewer.'||event,'ok',correlation);
$$;
CREATE FUNCTION app.reviewer_operator(action text,identity text,subject uuid,digest text,sealed text,confirmation text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u auth.users; p app.clergy_profiles; s app.submissions; result uuid; item record; correlation uuid:=gen_random_uuid();
BEGIN
 IF session_user<>'cape_clergy_dev' OR action IS NULL OR action NOT IN ('invite','cancel-invitation','revoke-reviewer','assign','revoke-assignment')
 OR confirmation IS DISTINCT FROM upper(action)||' '||identity||coalesce(' '||subject::text,'')
 THEN RAISE EXCEPTION 'Trusted operator confirmation required' USING ERRCODE='42501'; END IF;
 SELECT * INTO u FROM auth.users WHERE id=identity FOR UPDATE;
 SELECT * INTO p FROM app.clergy_profiles WHERE user_id=identity FOR UPDATE;
 IF u.id IS NULL OR p.user_id IS NULL THEN RAISE EXCEPTION 'Identity unavailable' USING ERRCODE='22023'; END IF;
 IF action IN ('invite','assign') AND (NOT u.email_verified OR p.approval_status<>'approved' OR NOT EXISTS(
 SELECT 1 FROM app.role_assignments WHERE user_id=identity AND role='clergy' AND revoked_at IS NULL))
 THEN RAISE EXCEPTION 'Eligible clergy required' USING ERRCODE='42501'; END IF;
 IF action='invite' THEN
  IF digest IS NULL OR digest !~ '^[0-9a-f]{64}$' OR sealed IS NULL OR length(sealed) NOT BETWEEN 80 AND 512
  OR EXISTS(SELECT 1 FROM app.role_assignments WHERE user_id=identity AND role='reviewer' AND revoked_at IS NULL)
  THEN RAISE EXCEPTION 'Invalid invitation' USING ERRCODE='22023'; END IF;
  -- Expired invitations are closed with immutable evidence before a replacement.
  FOR item IN UPDATE app.reviewer_invitations SET state='revoked',revoked_at=now()
   WHERE user_id=identity AND state='pending' AND expires_at<=now() RETURNING id LOOP
   PERFORM app.reviewer_operator_event(identity,item.id,NULL,'invitation_expired',correlation);
  END LOOP;
  INSERT INTO app.reviewer_invitations(user_id,mailbox,token_digest,issued_by,expires_at)
   VALUES(identity,u.email,digest,session_user,now()+interval '1 hour') RETURNING id INTO result;
  INSERT INTO app.reviewer_notifications(event_key,user_id,kind,invitation_id,sealed_token,recipient_email)
   VALUES('invitation:'||result,identity,'reviewer_invitation',result,sealed,u.email);
  PERFORM app.reviewer_operator_event(identity,result,NULL,'invitation_issued',correlation);
 ELSIF action='cancel-invitation' THEN
  UPDATE app.reviewer_invitations SET state='revoked',revoked_at=now() WHERE id=subject AND user_id=identity AND state='pending' RETURNING id INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='22023'; END IF;
  UPDATE app.reviewer_notifications SET cancelled_at=now(),sealed_token=NULL WHERE invitation_id=result AND delivered_at IS NULL;
  PERFORM app.reviewer_operator_event(identity,result,NULL,'invitation_revoked',correlation);
 ELSIF action='assign' THEN
  IF NOT EXISTS(SELECT 1 FROM app.role_assignments WHERE user_id=identity AND role='reviewer' AND revoked_at IS NULL)
  THEN RAISE EXCEPTION 'Active reviewer required' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM app.submissions WHERE id=subject FOR UPDATE;
  IF s.id IS NULL OR s.owner_id=identity OR s.status::text NOT IN ('submitted','under_review') THEN
   RAISE EXCEPTION 'Submission not assignable' USING ERRCODE='22023'; END IF;
  INSERT INTO app.reviewer_assignments(submission_id,revision,reviewer_id,assigned_by,correlation_id)
   VALUES(s.id,s.revision,identity,session_user,correlation) RETURNING id INTO result;
  INSERT INTO app.reviewer_notifications(event_key,user_id,kind,submission_id,assignment_id)
   VALUES('assignment:'||result,identity,'review_assigned',s.id,result);
  PERFORM app.reviewer_operator_event(identity,NULL,result,'assignment_created',correlation);
 ELSIF action='revoke-assignment' THEN
  UPDATE app.reviewer_assignments SET status='revoked',revoked_at=now() WHERE id=subject AND reviewer_id=identity AND status='active' RETURNING id INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Assignment unavailable' USING ERRCODE='22023'; END IF;
  PERFORM app.reviewer_operator_event(identity,NULL,result,'assignment_revoked',correlation);
 ELSE
  UPDATE app.role_assignments SET revoked_at=now() WHERE user_id=identity AND role='reviewer' AND revoked_at IS NULL;
  FOR item IN UPDATE app.reviewer_assignments SET status='revoked',revoked_at=now() WHERE reviewer_id=identity AND status='active' RETURNING id LOOP
   PERFORM app.reviewer_operator_event(identity,NULL,item.id,'assignment_revoked',correlation);
  END LOOP;
  FOR item IN UPDATE app.reviewer_invitations SET state='revoked',revoked_at=now() WHERE user_id=identity AND state='pending' RETURNING id LOOP
   PERFORM app.reviewer_operator_event(identity,item.id,NULL,'invitation_revoked',correlation);
  END LOOP;
  UPDATE app.reviewer_notifications SET cancelled_at=now(),sealed_token=NULL WHERE user_id=identity AND kind IN ('reviewer_invitation','review_assigned') AND delivered_at IS NULL;
  DELETE FROM auth.sessions WHERE user_id=identity;
  PERFORM app.reviewer_operator_event(identity,NULL,NULL,'authorization_revoked',correlation);
 END IF;
 RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.invalidate_reviewer_invitation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record; correlation uuid:=gen_random_uuid();
BEGIN
 IF NEW.email IS DISTINCT FROM OLD.email OR NEW.email_verified IS DISTINCT FROM OLD.email_verified THEN
  FOR item IN UPDATE app.reviewer_invitations SET state='revoked',revoked_at=now() WHERE user_id=NEW.id AND state='pending' RETURNING id LOOP
   PERFORM app.reviewer_operator_event(NEW.id,item.id,NULL,'invitation_identity_changed',correlation);
   UPDATE app.reviewer_notifications SET cancelled_at=now(),sealed_token=NULL WHERE invitation_id=item.id AND delivered_at IS NULL;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reviewer_identity_changed AFTER UPDATE OF email,email_verified ON auth.users FOR EACH ROW EXECUTE FUNCTION app.invalidate_reviewer_invitation();
CREATE TRIGGER reject_row_mutation BEFORE UPDATE OR DELETE ON app.reviewer_events FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON app.reviewer_events FOR EACH STATEMENT EXECUTE FUNCTION app.reject_history_mutation();
--> statement-breakpoint
CREATE FUNCTION app.inspect_reviewer_invitation(digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE inv app.reviewer_invitations;
BEGIN
 PERFORM app.require_submission_account();
 SELECT * INTO inv FROM app.reviewer_invitations WHERE token_digest=digest AND user_id=app.request_user_id()
 AND mailbox=(SELECT email FROM auth.users WHERE id=app.request_user_id() AND email_verified);
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('state',CASE WHEN inv.state='pending' AND inv.expires_at<=now() THEN 'expired' ELSE inv.state END,'mailbox',inv.mailbox,'expiresAt',inv.expires_at);
END $$;
CREATE FUNCTION app.accept_reviewer_invitation(digest text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE inv app.reviewer_invitations; actor text:=app.request_user_id(); correlation uuid:=gen_random_uuid();
BEGIN
 PERFORM 1 FROM auth.users WHERE id=actor AND email_verified FOR SHARE;
 PERFORM 1 FROM app.clergy_profiles WHERE user_id=actor AND approval_status='approved' FOR SHARE;
 PERFORM app.require_submission_account();
 PERFORM 1 FROM app.role_assignments WHERE user_id=actor AND role='clergy' AND revoked_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Eligible clergy required' USING ERRCODE='42501'; END IF;
 SELECT * INTO inv FROM app.reviewer_invitations WHERE token_digest=digest AND user_id=actor FOR UPDATE;
 IF NOT FOUND OR inv.state<>'pending' OR inv.expires_at<=now() OR inv.mailbox IS DISTINCT FROM (SELECT email FROM auth.users WHERE id=actor AND email_verified)
 THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='22023'; END IF;
 INSERT INTO app.role_assignments(user_id,role) VALUES(actor,'reviewer');
 UPDATE app.reviewer_invitations SET state='accepted',accepted_at=now() WHERE id=inv.id;
 INSERT INTO app.reviewer_events(reviewer_id,actor_id,invitation_id,action,correlation_id) VALUES(actor,actor,inv.id,'invitation_accepted',correlation);
 INSERT INTO app.audit_events(actor_id,target_user_id,action,outcome,correlation_id) VALUES(actor,actor,'reviewer.invitation_accepted','ok',correlation);
 UPDATE app.reviewer_notifications SET sealed_token=NULL,cancelled_at=coalesce(cancelled_at,now()) WHERE invitation_id=inv.id AND delivered_at IS NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.decide_review(target uuid,expected integer,transition text,feedback text,private_notes text,request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text:=app.request_user_id(); s app.submissions; assignment uuid; previous app.review_decisions; result uuid;
BEGIN
 -- Serialize revocation against this short transaction, always deriving actor internally.
 PERFORM 1 FROM auth.users WHERE id=actor AND email_verified FOR SHARE;
 PERFORM 1 FROM app.clergy_profiles WHERE user_id=actor AND approval_status='approved' FOR SHARE;
 PERFORM 1 FROM app.role_assignments WHERE user_id=actor AND role IN ('clergy','reviewer') AND revoked_at IS NULL FOR SHARE;
 IF NOT app.is_reviewer() THEN RAISE EXCEPTION 'Reviewer required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM app.submissions WHERE id=target FOR UPDATE;
 IF NOT FOUND OR NOT app.can_review_submission(target) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002'; END IF;
 SELECT id INTO assignment FROM app.reviewer_assignments WHERE submission_id=target AND revision=s.revision AND reviewer_id=actor AND status='active' FOR SHARE;
 IF assignment IS NULL THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002'; END IF;
 IF request IS NULL OR transition IS NULL OR transition NOT IN ('under_review','accepted','returned') OR feedback IS NULL OR private_notes IS NULL
 OR length(feedback)>10000 OR length(private_notes)>10000 OR expected IS NULL
 THEN RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023'; END IF;
 SELECT * INTO previous FROM app.review_decisions WHERE request_id=request;
 IF FOUND THEN
  IF previous.submission_id IS DISTINCT FROM target OR previous.reviewer_id IS DISTINCT FROM actor OR previous.outcome::text IS DISTINCT FROM transition
  OR previous.author_feedback IS DISTINCT FROM feedback OR previous.notes IS DISTINCT FROM private_notes OR previous.expected_version IS DISTINCT FROM expected
  OR previous.assignment_id IS DISTINCT FROM assignment THEN RAISE EXCEPTION 'Decision conflict' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('id',previous.id,'status',previous.outcome,'version',previous.expected_version+1,'replayed',true);
 END IF;
 IF s.version IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Decision conflict' USING ERRCODE='40001'; END IF;
 IF NOT ((s.status::text='submitted' AND transition='under_review') OR (s.status::text='under_review' AND transition IN ('accepted','returned')))
 THEN RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023'; END IF;
 -- Public feedback is deliberate. Acceptance requires an internal rationale;
 -- returning requires meaningful public guidance. Legacy notes stay private.
 IF (transition='returned' AND length(btrim(regexp_replace(feedback,'[[:space:]]+',' ','g')))<20)
 OR (transition='accepted' AND length(btrim(regexp_replace(private_notes,'[[:space:]]+',' ','g')))<20)
 THEN RAISE EXCEPTION 'Meaningful review rationale required' USING ERRCODE='22023'; END IF;
 UPDATE app.submissions SET status=transition::app.submission_status,version=version+1 WHERE id=target;
 INSERT INTO app.review_decisions(submission_id,reviewer_id,outcome,notes,author_feedback,revision,expected_version,request_id,assignment_id)
 VALUES(target,actor,transition::app.review_outcome,private_notes,feedback,s.revision,expected,request,assignment) RETURNING id INTO result;
 PERFORM app.snapshot_submission(target,'review_'||transition);
 INSERT INTO app.audit_events(actor_id,submission_id,action,outcome,correlation_id) VALUES(actor,target,'review.decision.'||transition,'ok',request);
 IF transition IN ('accepted','returned') THEN
 INSERT INTO app.reviewer_notifications(event_key,user_id,kind,submission_id) VALUES('decision:'||result,s.owner_id,'submission_'||transition,target);
 END IF;
 RETURN jsonb_build_object('id',result,'status',transition,'version',expected+1,'replayed',false);
END $$;
-- Explicit safe projection: author feedback never selects legacy private notes.
CREATE FUNCTION app.author_review_feedback(target uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app.require_submission_account();
 IF NOT EXISTS(SELECT 1 FROM app.submissions WHERE id=target AND owner_id=app.request_user_id()) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC,f.id DESC) FROM
 (SELECT id,outcome,author_feedback,revision,created_at FROM app.review_decisions WHERE submission_id=target AND revision IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 100) f),'[]'::jsonb);
END $$;
-- Reviewer history is limited to current assignment/revision. Author lifecycle stays owner-scoped.
CREATE FUNCTION app.reviewer_author(target uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT app.can_review_submission(target) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002'; END IF;
 RETURN (SELECT jsonb_build_object('name',p.full_name,'title',p.title,'parish',p.parish) FROM app.submissions s JOIN app.clergy_profiles p ON p.user_id=s.owner_id WHERE s.id=target);
END $$;
REVOKE ALL ON FUNCTION app.reviewer_operator_event(text,uuid,uuid,text,uuid),app.reviewer_operator(text,text,uuid,text,text,text),app.invalidate_reviewer_invitation(),
 app.inspect_reviewer_invitation(text),app.accept_reviewer_invitation(text),app.decide_review(uuid,integer,text,text,text,uuid),app.author_review_feedback(uuid),app.reviewer_author(uuid) FROM PUBLIC;
