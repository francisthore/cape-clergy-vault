CREATE TABLE "app"."administration_bootstrap" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "administration_singleton" CHECK ("app"."administration_bootstrap"."singleton")
);
--> statement-breakpoint
ALTER TABLE "app"."administration_bootstrap" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."administration_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" text,
	"operator" text,
	"target_id" text NOT NULL,
	"action" text NOT NULL,
	"capability" text NOT NULL,
	"reason" text NOT NULL,
	"result_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."administration_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."operational_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"capability" text NOT NULL,
	"delegated" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "operational_capability" CHECK ("app"."operational_grants"."capability" in ('review_coordinator','access_manager')),
	CONSTRAINT "operational_delegation" CHECK ("app"."operational_grants"."delegated" <@ array['approver','review_coordinator','reviewer','settings_manager']::text[] and ("app"."operational_grants"."capability"='access_manager' or cardinality("app"."operational_grants"."delegated")=0))
);
--> statement-breakpoint
ALTER TABLE "app"."operational_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."reviewer_notifications" DROP CONSTRAINT "reviewer_notification_kind";--> statement-breakpoint
ALTER TABLE "app"."reviewer_notifications" ADD COLUMN "submission_revision" integer;--> statement-breakpoint
ALTER TABLE "app"."administration_bootstrap" ADD CONSTRAINT "administration_bootstrap_user_id_clergy_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operational_grants" ADD CONSTRAINT "operational_grants_user_id_clergy_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operational_active_unique" ON "app"."operational_grants" USING btree ("user_id","capability") WHERE "app"."operational_grants"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "app"."reviewer_notifications" ADD CONSTRAINT "reviewer_notification_kind" CHECK ("app"."reviewer_notifications"."kind" in ('reviewer_invitation','review_assigned','submission_accepted','submission_returned','submission_received','submission_intake'));
--> statement-breakpoint
CREATE TRIGGER immutable_administration_events BEFORE UPDATE OR DELETE OR TRUNCATE ON app.administration_events FOR EACH STATEMENT EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER immutable_administration_bootstrap BEFORE UPDATE OR DELETE OR TRUNCATE ON app.administration_bootstrap FOR EACH STATEMENT EXECUTE FUNCTION app.reject_history_mutation();

-- Dedicated capabilities confer no submission/document/review SELECT policy.
CREATE FUNCTION app.has_operational(cap text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT app.document_account_allowed()
 AND EXISTS(SELECT 1 FROM app.role_assignments WHERE user_id=app.request_user_id() AND role='clergy' AND revoked_at IS NULL)
 AND EXISTS(SELECT 1 FROM app.operational_grants
 WHERE user_id=app.request_user_id() AND capability=cap AND revoked_at IS NULL)
$$;
CREATE FUNCTION app.require_operational(cap text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM 1 FROM auth.users WHERE id=app.request_user_id() FOR SHARE;
 PERFORM 1 FROM app.clergy_profiles WHERE user_id=app.request_user_id() FOR SHARE;
 PERFORM 1 FROM app.role_assignments WHERE user_id=app.request_user_id() AND revoked_at IS NULL FOR SHARE;
 PERFORM 1 FROM app.operational_grants WHERE user_id=app.request_user_id() AND revoked_at IS NULL FOR SHARE;
 IF NOT app.has_operational(cap) THEN RAISE EXCEPTION 'Operational capability required' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION app.require_delegation(cap text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM app.require_operational('access_manager');
 IF cap IS NULL OR NOT EXISTS(SELECT 1 FROM app.operational_grants WHERE user_id=app.request_user_id()
 AND capability='access_manager' AND revoked_at IS NULL AND cap=ANY(delegated)) THEN
 RAISE EXCEPTION 'Explicit delegation required' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION app.eligible_operational_identity(identity text, reviewer boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users u JOIN app.clergy_profiles p ON p.user_id=u.id
 WHERE u.id=identity AND u.email_verified AND p.approval_status='approved'
 AND EXISTS(SELECT 1 FROM app.role_assignments r WHERE r.user_id=u.id AND r.role='clergy' AND r.revoked_at IS NULL)
 AND (NOT reviewer OR EXISTS(SELECT 1 FROM app.role_assignments r WHERE r.user_id=u.id AND r.role='reviewer' AND r.revoked_at IS NULL))
 AND coalesce((SELECT e.action='accepted' AND e.notice_version IN ('repository-v1','repository-v1-proposed-2026-11-16') FROM app.popia_consent_events e
 WHERE e.user_id=u.id AND e.purpose='repository' ORDER BY e.created_at DESC,e.id DESC LIMIT 1),false))
$$;
CREATE FUNCTION app.coordination_inbox(page_number integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM app.require_operational('review_coordinator');
 IF page_number IS NULL OR page_number NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('total',(SELECT count(*) FROM app.submissions WHERE status IN ('submitted','under_review')),
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
CREATE FUNCTION app.coordinate_assignment(target uuid,expected_revision integer,identity text,request uuid) RETURNS uuid
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
CREATE FUNCTION app.coordination_revoke_assignment(assignment uuid,request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.reviewer_assignments; actor text:=app.request_user_id();
BEGIN
 PERFORM app.require_operational('review_coordinator');
 IF request IS NULL THEN RAISE EXCEPTION 'Request required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(request::text,422));
 SELECT * INTO a FROM app.reviewer_assignments WHERE id=assignment FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002'; END IF;
 IF EXISTS(SELECT 1 FROM app.reviewer_events WHERE correlation_id=request AND assignment_id=assignment AND actor_id=actor AND action='assignment_revoked') THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM app.reviewer_events WHERE correlation_id=request) THEN RAISE EXCEPTION 'Conflict' USING ERRCODE='40001'; END IF;
 IF a.status<>'active' THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='40001'; END IF;
 UPDATE app.reviewer_assignments SET status='revoked',revoked_at=now() WHERE id=assignment;
 INSERT INTO app.reviewer_events(reviewer_id,actor_id,assignment_id,action,correlation_id) VALUES(a.reviewer_id,actor,assignment,'assignment_revoked',request);
 INSERT INTO app.audit_events(actor_id,target_user_id,submission_id,action,outcome,correlation_id) VALUES(actor,a.reviewer_id,a.submission_id,'coordination.assignment_revoked','ok',request);
END $$;

-- Exact-ID lookup only. Does not expose proofs, private resources or review notes.
CREATE FUNCTION app.access_identity(identity text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app.require_operational('access_manager');
 SELECT jsonb_build_object('id',u.id,'email',u.email,'verified',u.email_verified,'name',p.full_name,'approval',p.approval_status,
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
CREATE FUNCTION app.manage_access(action text,identity text,cap text,mailbox text,confirmation text,reason text,request uuid,subject uuid DEFAULT NULL,digest text DEFAULT NULL,sealed text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor text:=app.request_user_id(); u auth.users; result uuid; item record; previous app.administration_events;
BEGIN
 PERFORM app.require_delegation(cap);
 IF action IS NULL OR action NOT IN ('grant','revoke','invite','cancel-invitation') OR request IS NULL OR reason IS NULL OR length(btrim(reason)) NOT BETWEEN 10 AND 1000
 OR identity IS NULL OR confirmation IS DISTINCT FROM upper(action)||' '||identity||' '||cap
 OR (cap='reviewer' AND action='grant') OR (cap<>'reviewer' AND action NOT IN ('grant','revoke'))
 OR (identity=actor AND action IN ('grant','revoke')) THEN RAISE EXCEPTION 'Explicit authorized confirmation required' USING ERRCODE='42501'; END IF;
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

-- Owner terminal only; never granted to runtime. No invocation in migration/startup.
CREATE FUNCTION app.operator_administration(mode text,identity text,caps text[],delegations text[],reason text,confirmation text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE correlation uuid:=gen_random_uuid(); cap text; state text; grant_id uuid;
BEGIN
 IF session_user<>'cape_clergy_dev' OR mode IS NULL OR mode NOT IN ('bootstrap','recover','revoke') OR identity IS NULL
 OR caps IS NULL OR cardinality(caps)=0 OR NOT caps <@ ARRAY['approver','review_coordinator','access_manager']::text[]
 OR delegations IS NULL OR NOT delegations <@ ARRAY['approver','review_coordinator','reviewer','settings_manager']::text[]
 OR ('access_manager'<>ALL(caps) AND cardinality(delegations)>0)
 OR reason IS NULL OR length(btrim(reason)) NOT BETWEEN 20 AND 1000
 OR confirmation IS DISTINCT FROM upper(mode)||' '||identity||' CAPABILITIES '||array_to_string(caps,',')||' DELEGATE '||array_to_string(delegations,',')
 THEN RAISE EXCEPTION 'Trusted exact identity confirmation required' USING ERRCODE='42501'; END IF;
 LOCK TABLE app.administration_bootstrap IN EXCLUSIVE MODE;
 IF mode='bootstrap' AND (EXISTS(SELECT 1 FROM app.administration_bootstrap) OR EXISTS(SELECT 1 FROM app.operational_grants WHERE capability='access_manager')) THEN RAISE EXCEPTION 'Already bootstrapped' USING ERRCODE='42501'; END IF;
 IF mode='recover' AND NOT EXISTS(SELECT 1 FROM app.administration_bootstrap) THEN RAISE EXCEPTION 'Bootstrap required' USING ERRCODE='42501'; END IF;
 IF mode='revoke' THEN
  IF cardinality(delegations)<>0 THEN RAISE EXCEPTION 'Revocation cannot delegate' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM auth.users WHERE id=identity FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exact identity required' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM app.clergy_profiles WHERE user_id=identity FOR UPDATE;
  FOREACH cap IN ARRAY caps LOOP
   IF cap='approver' THEN UPDATE app.role_assignments SET revoked_at=now() WHERE user_id=identity AND role='approver' AND revoked_at IS NULL;
   ELSE UPDATE app.operational_grants SET revoked_at=now() WHERE user_id=identity AND capability=cap AND revoked_at IS NULL; END IF;
   INSERT INTO app.administration_events(id,operator,target_id,action,capability,reason) VALUES(gen_random_uuid(),session_user,identity,mode,cap,btrim(reason));
  END LOOP;
  DELETE FROM auth.sessions WHERE user_id=identity;
  INSERT INTO app.audit_events(target_user_id,action,outcome,correlation_id) VALUES(identity,'administration.operator_revoke','ok',correlation);
  RETURN;
 END IF;
 PERFORM 1 FROM auth.users WHERE id=identity AND email_verified FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Verified identity required' USING ERRCODE='42501'; END IF;
 SELECT approval_status::text INTO state FROM app.clergy_profiles WHERE user_id=identity FOR UPDATE;
 IF state IS NULL OR state NOT IN ('pending','approved') OR (mode='recover' AND state<>'approved')
 OR NOT EXISTS(SELECT 1 FROM app.role_assignments WHERE user_id=identity AND role='clergy' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'Registered clergy required' USING ERRCODE='42501'; END IF;
 IF mode='bootstrap' THEN
  INSERT INTO app.administration_bootstrap(user_id) VALUES(identity);
  IF state='pending' THEN
   UPDATE app.clergy_profiles SET approval_status='approved' WHERE user_id=identity;
   INSERT INTO app.account_approval_events(user_id,actor_id,status,reason) VALUES(identity,identity,'approved','Trusted exact-identity first administrator bootstrap by '||session_user);
   INSERT INTO app.approval_notifications(event_key,user_id,kind) VALUES('administration-bootstrap:'||correlation,identity,'approved');
  END IF;
 END IF;
 IF NOT app.eligible_operational_identity(identity) THEN RAISE EXCEPTION 'Current consent required' USING ERRCODE='42501'; END IF;
 FOREACH cap IN ARRAY caps LOOP
  grant_id:=NULL;
  IF cap='approver' THEN
   INSERT INTO app.role_assignments(user_id,role) VALUES(identity,'approver') ON CONFLICT DO NOTHING RETURNING id INTO grant_id;
  ELSE
   UPDATE app.operational_grants SET revoked_at=now() WHERE user_id=identity AND capability=cap AND revoked_at IS NULL;
   INSERT INTO app.operational_grants(user_id,capability,delegated) VALUES(identity,cap,CASE WHEN cap='access_manager' THEN delegations ELSE ARRAY[]::text[] END) RETURNING id INTO grant_id;
  END IF;
  INSERT INTO app.administration_events(id,operator,target_id,action,capability,reason,result_id) VALUES(gen_random_uuid(),session_user,identity,mode,cap,btrim(reason)||CASE WHEN cap='access_manager' THEN ' | Explicit delegated capabilities: '||array_to_string(delegations,',') ELSE '' END,grant_id);
 END LOOP;
 INSERT INTO app.audit_events(target_user_id,action,outcome,correlation_id) VALUES(identity,'administration.operator_'||mode,'ok',correlation);
END $$;

-- Only a successful draft -> submitted transition creates these new intents.
CREATE FUNCTION app.queue_submission_received() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE received uuid; recipients integer;
BEGIN
 IF OLD.status='draft' AND NEW.status='submitted' THEN
  INSERT INTO app.reviewer_notifications(event_key,user_id,kind,submission_id,submission_revision)
  VALUES('received:'||NEW.id||':'||NEW.revision,NEW.owner_id,'submission_received',NEW.id,NEW.revision) RETURNING id INTO received;
  INSERT INTO app.reviewer_notifications(event_key,user_id,kind,submission_id,submission_revision)
  SELECT 'intake:'||received||':'||g.user_id,g.user_id,'submission_intake',NEW.id,NEW.revision FROM app.operational_grants g
  WHERE g.capability='review_coordinator' AND g.revoked_at IS NULL AND app.eligible_operational_identity(g.user_id);
  GET DIAGNOSTICS recipients=ROW_COUNT;
  INSERT INTO app.audit_events(actor_id,submission_id,action,outcome,correlation_id)
  VALUES(app.request_user_id(),NEW.id,CASE WHEN recipients=0 THEN 'submission.intake_no_recipients' ELSE 'submission.intake_queued' END,'ok',received);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER submission_received AFTER UPDATE OF status ON app.submissions FOR EACH ROW EXECUTE FUNCTION app.queue_submission_received();
ALTER FUNCTION app.notification_eligible(text,uuid) RENAME TO notification_eligible_before_phase422;
CREATE FUNCTION app.notification_eligible(queue text,notification uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n app.reviewer_notifications;
BEGIN
 IF queue='reviewer' THEN
  SELECT * INTO n FROM app.reviewer_notifications WHERE id=notification;
  IF n.kind IN ('submission_received','submission_intake') THEN
   IF n.cancelled_at IS NOT NULL OR n.delivered_at IS NOT NULL OR NOT app.eligible_operational_identity(n.user_id)
   OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=n.user_id AND (n.recipient_email IS NULL OR n.recipient_email=email)) THEN RETURN false; END IF;
   IF n.kind='submission_received' THEN RETURN EXISTS(SELECT 1 FROM app.submissions WHERE id=n.submission_id AND owner_id=n.user_id); END IF;
   RETURN EXISTS(SELECT 1 FROM app.operational_grants WHERE user_id=n.user_id AND capability='review_coordinator' AND revoked_at IS NULL)
   AND EXISTS(SELECT 1 FROM app.submissions s WHERE s.id=n.submission_id AND s.revision=n.submission_revision AND s.status='submitted'
   AND NOT EXISTS(SELECT 1 FROM app.reviewer_assignments a WHERE a.submission_id=s.id AND a.revision=s.revision AND a.status='active' AND app.eligible_operational_identity(a.reviewer_id,true)));
  END IF;
 END IF;
 RETURN app.notification_eligible_before_phase422(queue,notification);
END $$;
-- Normal UI and preserved emergency assignment commands share cancellation.
CREATE FUNCTION app.cancel_intake_on_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.status='active' THEN
  UPDATE app.reviewer_notifications SET cancelled_at=now(),lease_token=NULL
  WHERE submission_id=NEW.submission_id AND submission_revision=NEW.revision AND kind='submission_intake'
  AND delivered_at IS NULL AND cancelled_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER intake_assignment_created AFTER INSERT ON app.reviewer_assignments FOR EACH ROW EXECUTE FUNCTION app.cancel_intake_on_assignment();
REVOKE ALL ON FUNCTION app.cancel_intake_on_assignment() FROM PUBLIC;
CREATE FUNCTION app.author_assignment_status(target uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM app.require_submission_account();
 IF NOT EXISTS(SELECT 1 FROM app.submissions WHERE id=target AND owner_id=app.request_user_id()) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='P0002'; END IF;
 RETURN CASE WHEN EXISTS(SELECT 1 FROM app.reviewer_assignments a JOIN app.submissions s ON s.id=a.submission_id
 WHERE s.id=target AND a.revision=s.revision AND a.status='active' AND app.eligible_operational_identity(a.reviewer_id,true)) THEN 'assigned' ELSE 'unassigned' END;
END $$;
REVOKE ALL ON FUNCTION app.has_operational(text),app.require_operational(text),app.require_delegation(text),app.eligible_operational_identity(text,boolean),
 app.coordination_inbox(integer),app.coordinate_assignment(uuid,integer,text,uuid),app.coordination_revoke_assignment(uuid,uuid),app.access_identity(text),
 app.manage_access(text,text,text,text,text,text,uuid,uuid,text,text),app.operator_administration(text,text,text[],text[],text,text),
 app.queue_submission_received(),app.notification_eligible(text,uuid),app.notification_eligible_before_phase422(text,uuid),app.author_assignment_status(uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cape_clergy_runtime') THEN
 REVOKE ALL ON app.operational_grants,app.administration_events,app.administration_bootstrap FROM cape_clergy_runtime;
 GRANT EXECUTE ON FUNCTION app.has_operational(text),app.coordination_inbox(integer),
 app.coordinate_assignment(uuid,integer,text,uuid),app.coordination_revoke_assignment(uuid,uuid),
 app.access_identity(text),app.manage_access(text,text,text,text,text,text,uuid,uuid,text,text),app.author_assignment_status(uuid) TO cape_clergy_runtime;
END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cape_clergy_runtime') THEN
 GRANT EXECUTE ON FUNCTION app.require_delegation(text) TO cape_clergy_runtime;
END IF; END $$;
