-- Phase 4.3.1: independent activation/assignment and external-transfer classification fence.
-- Forward only; existing reviewer grants, assignments and immutable evidence stay intact.
CREATE OR REPLACE FUNCTION app.manage_access(action text,identity text,cap text,mailbox text,confirmation text,reason text,request uuid,subject uuid DEFAULT NULL,digest text DEFAULT NULL,sealed text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text:=app.request_user_id(); u auth.users; result uuid; item record; previous app.administration_events;
BEGIN
 PERFORM app.require_delegation(cap);
 IF action IS NULL OR action NOT IN ('grant','revoke','invite','cancel-invitation') OR request IS NULL OR reason IS NULL OR length(btrim(reason)) NOT BETWEEN 10 AND 1000
 OR identity IS NULL OR confirmation IS DISTINCT FROM upper(action)||' '||identity||' '||cap
 OR (cap='reviewer' AND action='grant') OR (cap<>'reviewer' AND action NOT IN ('grant','revoke'))
 OR (identity=actor AND action IN ('grant','revoke','invite')) THEN RAISE EXCEPTION 'Explicit authorized confirmation required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(request::text,422));
 SELECT * INTO u FROM auth.users WHERE id=identity FOR UPDATE;
 PERFORM 1 FROM app.clergy_profiles WHERE user_id=identity FOR UPDATE;
 IF u.id IS NULL OR u.email IS DISTINCT FROM mailbox THEN RAISE EXCEPTION 'Identity changed' USING ERRCODE='40001'; END IF;
 SELECT * INTO previous FROM app.administration_events WHERE id=request;
 IF FOUND THEN
  IF previous.actor_id IS DISTINCT FROM actor OR previous.target_id IS DISTINCT FROM identity OR previous.action IS DISTINCT FROM action
  OR previous.capability IS DISTINCT FROM cap OR previous.reason IS DISTINCT FROM btrim(reason)
  OR (action='cancel-invitation' AND previous.result_id IS DISTINCT FROM subject) THEN RAISE EXCEPTION 'Conflict' USING ERRCODE='40001'; END IF;
  RETURN previous.result_id;
 END IF;
 IF action IN ('grant','invite') AND NOT app.eligible_operational_identity(identity) THEN RAISE EXCEPTION 'Eligible identity required' USING ERRCODE='42501'; END IF;
 IF cap='reviewer' THEN
  IF action='invite' THEN
   IF digest IS NULL OR digest !~ '^[0-9a-f]{64}$' OR sealed IS NULL OR length(sealed) NOT BETWEEN 80 AND 512
   OR EXISTS(SELECT 1 FROM app.role_assignments WHERE user_id=identity AND role='reviewer' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'Invalid invitation' USING ERRCODE='22023'; END IF;
   FOR item IN UPDATE app.reviewer_invitations SET state='revoked',revoked_at=now() WHERE user_id=identity AND state='pending' AND expires_at<=now() RETURNING id LOOP
    INSERT INTO app.reviewer_events(reviewer_id,actor_id,invitation_id,action,correlation_id) VALUES(identity,actor,item.id,'invitation_expired',request);
    UPDATE app.reviewer_notifications SET cancelled_at=now(),sealed_token=NULL,lease_token=NULL WHERE invitation_id=item.id AND delivered_at IS NULL;
   END LOOP;
   INSERT INTO app.reviewer_invitations(user_id,mailbox,token_digest,issued_by,expires_at) VALUES(identity,u.email,digest,actor,now()+interval '1 hour') RETURNING id INTO result;
   INSERT INTO app.reviewer_notifications(event_key,user_id,kind,invitation_id,sealed_token,recipient_email) VALUES('invitation:'||result,identity,'reviewer_invitation',result,sealed,u.email);
   INSERT INTO app.reviewer_events(reviewer_id,actor_id,invitation_id,action,correlation_id) VALUES(identity,actor,result,'invitation_issued',request);
  ELSIF action='cancel-invitation' THEN
   UPDATE app.reviewer_invitations SET state='revoked',revoked_at=now() WHERE id=subject AND user_id=identity AND state='pending' RETURNING id INTO result;
   IF result IS NULL THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='40001'; END IF;
   UPDATE app.reviewer_notifications SET cancelled_at=now(),sealed_token=NULL,lease_token=NULL WHERE invitation_id=result AND delivered_at IS NULL;
   INSERT INTO app.reviewer_events(reviewer_id,actor_id,invitation_id,action,correlation_id) VALUES(identity,actor,result,'invitation_revoked',request);
  ELSE
   UPDATE app.role_assignments SET revoked_at=now() WHERE user_id=identity AND role='reviewer' AND revoked_at IS NULL;
   FOR item IN UPDATE app.reviewer_assignments SET status='revoked',revoked_at=now() WHERE reviewer_id=identity AND status='active' RETURNING id LOOP
    INSERT INTO app.reviewer_events(reviewer_id,actor_id,assignment_id,action,correlation_id) VALUES(identity,actor,item.id,'assignment_revoked',request);
   END LOOP;
   FOR item IN UPDATE app.reviewer_invitations SET state='revoked',revoked_at=now() WHERE user_id=identity AND state='pending' RETURNING id LOOP
    INSERT INTO app.reviewer_events(reviewer_id,actor_id,invitation_id,action,correlation_id) VALUES(identity,actor,item.id,'invitation_revoked',request);
   END LOOP;
   UPDATE app.reviewer_notifications SET cancelled_at=now(),sealed_token=NULL,lease_token=NULL WHERE user_id=identity AND kind IN ('reviewer_invitation','review_assigned') AND delivered_at IS NULL;
   INSERT INTO app.reviewer_events(reviewer_id,actor_id,action,correlation_id) VALUES(identity,actor,'authorization_revoked',request);
  END IF;
 ELSIF cap='approver' THEN
  IF action='grant' THEN INSERT INTO app.role_assignments(user_id,role,granted_by) VALUES(identity,'approver',actor) RETURNING id INTO result;
  ELSE UPDATE app.role_assignments SET revoked_at=now() WHERE user_id=identity AND role='approver' AND revoked_at IS NULL RETURNING id INTO result; END IF;
 ELSIF cap='review_coordinator' THEN
  IF action='grant' THEN INSERT INTO app.operational_grants(user_id,capability) VALUES(identity,cap) RETURNING id INTO result;
  ELSE UPDATE app.operational_grants SET revoked_at=now() WHERE user_id=identity AND capability=cap AND revoked_at IS NULL RETURNING id INTO result; END IF;
 ELSIF cap='settings_manager' THEN
  IF action='grant' THEN INSERT INTO app.settings_managers(user_id) VALUES(identity) ON CONFLICT(user_id) DO UPDATE SET granted_at=now(),revoked_at=NULL;
  ELSE UPDATE app.settings_managers SET revoked_at=now() WHERE user_id=identity AND revoked_at IS NULL; END IF;
 ELSE RAISE EXCEPTION 'Capability unavailable' USING ERRCODE='42501'; END IF;
 IF action='revoke' THEN DELETE FROM auth.sessions WHERE user_id=identity; END IF;
 INSERT INTO app.administration_events(id,actor_id,target_id,action,capability,reason,result_id) VALUES(request,actor,identity,action,cap,btrim(reason),result);
 INSERT INTO app.audit_events(actor_id,target_user_id,action,outcome,correlation_id) VALUES(actor,identity,'access.'||action||'.'||cap,'ok',request);
 RETURN result;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.accept_reviewer_invitation(digest text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE inv app.reviewer_invitations; actor text:=app.request_user_id(); correlation uuid:=gen_random_uuid();
BEGIN
 PERFORM 1 FROM auth.users WHERE id=actor AND email_verified FOR SHARE;
 PERFORM 1 FROM app.clergy_profiles WHERE user_id=actor AND approval_status='approved' FOR SHARE;
 PERFORM app.require_submission_account();
 PERFORM 1 FROM app.role_assignments WHERE user_id=actor AND role='clergy' AND revoked_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Eligible clergy required' USING ERRCODE='42501'; END IF;
 SELECT * INTO inv FROM app.reviewer_invitations WHERE token_digest=digest AND user_id=actor FOR UPDATE;
 IF NOT FOUND OR inv.issued_by=actor OR inv.state<>'pending' OR inv.expires_at<=now() OR inv.mailbox IS DISTINCT FROM (SELECT email FROM auth.users WHERE id=actor AND email_verified)
 THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='22023'; END IF;
 INSERT INTO app.role_assignments(user_id,role) VALUES(actor,'reviewer');
 UPDATE app.reviewer_invitations SET state='accepted',accepted_at=now() WHERE id=inv.id;
 INSERT INTO app.reviewer_events(reviewer_id,actor_id,invitation_id,action,correlation_id) VALUES(actor,actor,inv.id,'invitation_accepted',correlation);
 INSERT INTO app.audit_events(actor_id,target_user_id,action,outcome,correlation_id) VALUES(actor,actor,'reviewer.invitation_accepted','ok',correlation);
 UPDATE app.reviewer_notifications SET sealed_token=NULL,cancelled_at=coalesce(cancelled_at,now()) WHERE invitation_id=inv.id AND delivered_at IS NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.coordinate_assignment(target uuid,expected_revision integer,identity text,request uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s app.submissions; result uuid; actor text:=app.request_user_id(); previous app.reviewer_events;
BEGIN
 PERFORM app.require_operational('review_coordinator');
 IF request IS NULL OR target IS NULL OR identity IS NULL OR expected_revision IS NULL THEN RAISE EXCEPTION 'Invalid assignment' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(request::text,422));
 PERFORM 1 FROM auth.users WHERE id=identity FOR SHARE;
 PERFORM 1 FROM app.clergy_profiles WHERE user_id=identity FOR SHARE;
 PERFORM 1 FROM app.role_assignments WHERE user_id=identity AND revoked_at IS NULL FOR SHARE;
 SELECT * INTO s FROM app.submissions WHERE id=target FOR UPDATE;
 IF s.id IS NULL OR s.revision<>expected_revision OR s.owner_id=identity OR NOT app.eligible_operational_identity(identity,true)
 THEN RAISE EXCEPTION 'Assignment unavailable' USING ERRCODE='40001'; END IF;
 IF s.confidential AND identity=actor THEN RAISE EXCEPTION 'Independent confidential assignment required' USING ERRCODE='42501'; END IF;
 SELECT * INTO previous FROM app.reviewer_events WHERE correlation_id=request AND action='assignment_created';
 IF FOUND THEN
  IF previous.actor_id IS DISTINCT FROM actor OR previous.reviewer_id IS DISTINCT FROM identity OR NOT EXISTS(
   SELECT 1 FROM app.reviewer_assignments WHERE id=previous.assignment_id AND submission_id=target AND revision=expected_revision AND status='active')
  THEN RAISE EXCEPTION 'Assignment conflict' USING ERRCODE='40001'; END IF;
  RETURN previous.assignment_id;
 END IF;
 IF s.status NOT IN ('submitted','under_review') THEN RAISE EXCEPTION 'Not assignable' USING ERRCODE='22023'; END IF;
 INSERT INTO app.reviewer_assignments(submission_id,revision,reviewer_id,assigned_by,correlation_id)
 VALUES(target,expected_revision,identity,actor,request) RETURNING id INTO result;
 INSERT INTO app.reviewer_events(reviewer_id,actor_id,assignment_id,action,correlation_id) VALUES(identity,actor,result,'assignment_created',request);
 INSERT INTO app.audit_events(actor_id,target_user_id,submission_id,action,outcome,correlation_id) VALUES(actor,identity,target,'coordination.assignment_created','ok',request);
 INSERT INTO app.reviewer_notifications(event_key,user_id,kind,submission_id,assignment_id) VALUES('assignment:'||result,identity,'review_assigned',target,result);
 RETURN result;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.reserve_bouncer_scan(doc uuid,token uuid,used integer,quota integer,period_value text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.document_scans; d app.documents; s app.submissions; reserved_count integer;
BEGIN
 PERFORM app.require_scanner_worker();
 SELECT p.* INTO s FROM app.submissions p JOIN app.documents x ON x.submission_id=p.id WHERE x.id=doc FOR UPDATE OF p;
 SELECT * INTO d FROM app.documents WHERE id=doc FOR UPDATE;
 SELECT * INTO j FROM app.document_scans WHERE document_id=doc FOR UPDATE;
 IF j.document_id IS NULL OR j.provider<>'bouncer' OR j.state<>'scanning' OR j.lease_token IS DISTINCT FROM token OR j.lease_until<=now()
 OR j.external_scan_id IS NOT NULL OR j.provider_status<>'new' THEN RETURN false; END IF;
 PERFORM set_config('cape.user_id',s.owner_id,true);
 IF d.excluded OR d.state<>'scanning' OR s.kind<>'document' OR s.revision IS DISTINCT FROM j.submission_revision
 OR d.sha256 IS DISTINCT FROM j.expected_sha256 OR d.byte_size IS DISTINCT FROM j.expected_byte_size
 OR s.confidential OR NOT app.document_account_allowed() THEN RAISE EXCEPTION 'Scan ineligible' USING ERRCODE='42501'; END IF;
 IF used IS NULL OR used<0 OR quota IS NULL OR quota<1 OR quota>500 OR period_value IS DISTINCT FROM to_char(now() AT TIME ZONE 'UTC','YYYY-MM')
 THEN RAISE EXCEPTION 'Invalid free quota evidence' USING ERRCODE='22023'; END IF;
 INSERT INTO app.scanner_budget(period) VALUES(period_value) ON CONFLICT DO NOTHING;
 SELECT reserved INTO reserved_count FROM app.scanner_budget WHERE period=period_value FOR UPDATE;
 IF greatest(reserved_count,used)>=quota OR EXISTS(SELECT 1 FROM app.scanner_budget WHERE period=period_value AND blocked_until>now()) THEN
  UPDATE app.scanner_budget SET observed_used=used,blocked_until=(date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC',updated_at=now() WHERE period=period_value;
  RETURN false;
 END IF;
 -- Write fence serializes confidentiality changes, including repeatable-read transactions.
 -- No status/metadata changes or workflow events are made by this identity-only update.
 UPDATE app.submissions SET id=id WHERE id=s.id;
 UPDATE app.scanner_budget SET reserved=greatest(reserved_count,used)+1,observed_used=used,updated_at=now() WHERE period=period_value;
 UPDATE app.document_scans SET provider_status='submitting',submitted_at=now() WHERE document_id=doc;
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id) VALUES(doc,j.attempts,'bouncer.submitting',j.correlation_id);
 RETURN true;
END $$;
--> statement-breakpoint
-- Classification cannot be changed around a committed external-transfer intent. Keep all
-- prior evidence; authors must use a separate confidential draft instead. Excluded/old
-- attachments also retain their transfer history, so exclusion is not an escape hatch.
CREATE FUNCTION app.guard_external_scan_classification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.confidential AND NOT OLD.confidential AND EXISTS(
  SELECT 1 FROM app.documents d JOIN app.document_scans j ON j.document_id=d.id
  WHERE d.submission_id=OLD.id AND j.provider='bouncer'
  AND (j.submitted_at IS NOT NULL OR j.external_scan_id IS NOT NULL OR j.provider_status IN ('submitting','ambiguous')))
 THEN RAISE EXCEPTION 'External screening already initiated; create a separate confidential draft' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER external_scan_classification BEFORE UPDATE OF confidential ON app.submissions
 FOR EACH ROW EXECUTE FUNCTION app.guard_external_scan_classification();
REVOKE ALL ON FUNCTION app.guard_external_scan_classification() FROM PUBLIC;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.coordination_inbox(page_number integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM app.require_operational('review_coordinator');
 IF page_number IS NULL OR page_number NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('actorId',app.request_user_id(),'total',(SELECT count(*) FROM app.submissions WHERE status IN ('submitted','under_review')),
 'unassigned',(SELECT count(*) FROM app.submissions s WHERE s.status IN ('submitted','under_review') AND NOT EXISTS(SELECT 1 FROM app.reviewer_assignments a
 WHERE a.submission_id=s.id AND a.revision=s.revision AND a.status='active' AND app.eligible_operational_identity(a.reviewer_id,true))),
 'items',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.submitted_at,x.id) FROM (
 SELECT s.id,s.revision,s.status,s.kind,s.submitted_at,s.confidential,
 CASE WHEN s.confidential THEN 'Confidential resource' ELSE s.title END AS title,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'reviewerId',a.reviewer_id,'assignedBy',a.assigned_by,'createdAt',a.created_at,'status',a.status,
 'eligible',app.eligible_operational_identity(a.reviewer_id,true)) ORDER BY a.created_at,a.id)
 FROM app.reviewer_assignments a WHERE a.submission_id=s.id AND a.revision=s.revision),'[]'::jsonb) AS assignments
 FROM app.submissions s WHERE s.status IN ('submitted','under_review') ORDER BY s.submitted_at,s.id LIMIT 20 OFFSET (page_number-1)*20) x),'[]'::jsonb),
 'reviewers',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.full_name,x.user_id) FROM (
 SELECT p.user_id,p.full_name,p.parish FROM app.clergy_profiles p WHERE app.eligible_operational_identity(p.user_id,true) ORDER BY p.full_name,p.user_id LIMIT 200) x),'[]'::jsonb));
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.access_identity(identity text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app.require_operational('access_manager');
 SELECT jsonb_build_object('isSelf',u.id=app.request_user_id(),'id',u.id,'email',u.email,'verified',u.email_verified,'name',p.full_name,'approval',p.approval_status,
 'eligible',app.eligible_operational_identity(u.id),
 'capabilities',coalesce((SELECT jsonb_agg(c) FROM (
 SELECT role::text c FROM app.role_assignments WHERE user_id=u.id AND revoked_at IS NULL
 UNION ALL SELECT capability FROM app.operational_grants WHERE user_id=u.id AND revoked_at IS NULL
 UNION ALL SELECT 'settings_manager' FROM app.settings_managers WHERE user_id=u.id AND revoked_at IS NULL) cs),'[]'::jsonb),
 'delegated',(SELECT delegated FROM app.operational_grants WHERE user_id=app.request_user_id() AND capability='access_manager' AND revoked_at IS NULL),
 'invitations',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
 SELECT id,created_at,expires_at,CASE WHEN state='pending' AND expires_at<=now() THEN 'expired' ELSE state END AS state
 FROM app.reviewer_invitations WHERE user_id=u.id ORDER BY created_at DESC,id DESC LIMIT 20) x),'[]'::jsonb)) INTO result
 FROM auth.users u JOIN app.clergy_profiles p ON p.user_id=u.id WHERE u.id=identity;
 IF result IS NULL THEN RAISE EXCEPTION 'Identity unavailable' USING ERRCODE='P0002'; END IF;
 RETURN result;
END $$;

--> statement-breakpoint
-- A historical provider verdict is retained as evidence, not an approval for
-- confidential external processing. It cannot authorize downloads/submission.
CREATE OR REPLACE FUNCTION app.document_is_clean(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.documents d JOIN app.document_scans j ON j.document_id=d.id
 JOIN app.submissions s ON s.id=d.submission_id
 WHERE d.id=doc AND d.state='available' AND j.state='clean' AND j.expected_sha256=d.sha256
 AND j.scanned_sha256=d.sha256 AND j.completed_at IS NOT NULL
 AND NOT (s.confidential AND j.provider='bouncer'))
$$;
