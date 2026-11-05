-- Only the dedicated capability authorizes registration administration.
CREATE FUNCTION app.is_approver() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
 SELECT app.is_active() AND EXISTS (SELECT 1 FROM auth.users WHERE id=app.request_user_id() AND email_verified)
 AND EXISTS (SELECT 1 FROM app.role_assignments WHERE user_id=app.request_user_id()
 AND role::text='approver' AND revoked_at IS NULL)
$$;
--> statement-breakpoint
CREATE FUNCTION app.require_approver() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
BEGIN
 -- Locks serialize decisions against operator revocation and status changes.
 PERFORM 1 FROM app.clergy_profiles WHERE user_id=app.request_user_id() FOR SHARE;
 PERFORM 1 FROM auth.users WHERE id=app.request_user_id() FOR SHARE;
 PERFORM 1 FROM app.role_assignments WHERE user_id=app.request_user_id()
   AND role::text='approver' AND revoked_at IS NULL FOR SHARE;
 IF NOT app.is_approver() THEN RAISE EXCEPTION 'Approval permission required' USING ERRCODE='42501'; END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.registration_list(filter_status text, search_text text, page_number integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app.require_approver();
 IF filter_status IS NULL OR filter_status NOT IN ('pending','approved','rejected','suspended','all')
 OR search_text IS NULL OR length(search_text)>120 OR page_number IS NULL OR page_number NOT BETWEEN 1 AND 100000 THEN
 RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('total', count(*), 'page', page_number) INTO result
 FROM app.clergy_profiles p JOIN auth.users u ON u.id=p.user_id
 WHERE (filter_status='all' OR p.approval_status::text=filter_status)
 AND (search_text='' OR strpos(lower(p.full_name || ' ' || p.parish || ' ' || u.email),lower(search_text))>0);
 RETURN result || jsonb_build_object('rows', coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (
 SELECT p.user_id,p.full_name,p.title,p.parish,p.approval_status,p.created_at,u.email,u.email_verified
 FROM app.clergy_profiles p JOIN auth.users u ON u.id=p.user_id
 WHERE (filter_status='all' OR p.approval_status::text=filter_status)
 AND (search_text='' OR strpos(lower(p.full_name || ' ' || p.parish || ' ' || u.email),lower(search_text))>0)
 ORDER BY (p.approval_status='pending') DESC,p.created_at,p.user_id LIMIT 20 OFFSET (page_number-1)*20
 ) r),'[]'::jsonb));
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.registration_detail(target_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app.require_approver();
 SELECT jsonb_build_object('user_id',p.user_id,'full_name',p.full_name,'title',p.title,
 'parish',p.parish,'created_at',p.created_at,'approval_status',p.approval_status,
 'email',u.email,'email_verified',u.email_verified) INTO result
 FROM app.clergy_profiles p JOIN auth.users u ON u.id=p.user_id WHERE p.user_id=target_id;
 IF result IS NULL THEN RAISE EXCEPTION 'Registration not found' USING ERRCODE='P0002'; END IF;
 RETURN result || jsonb_build_object('history',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (
 SELECT e.id,e.status,e.reason,e.created_at,e.actor_id,a.full_name AS actor_name
 FROM app.account_approval_events e JOIN app.clergy_profiles a ON a.user_id=e.actor_id
 WHERE e.user_id=target_id ORDER BY e.created_at,e.id) r),'[]'::jsonb));
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app.decide_registration(target_id text, decision text, decision_reason text, request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor text := app.request_user_id(); current_status text; next_status app.approval_status;
 previous app.account_approval_events; verified boolean;
BEGIN
 PERFORM app.require_approver();
 IF target_id IS NULL OR target_id=actor OR length(target_id) NOT BETWEEN 1 AND 200
 OR request_id IS NULL OR decision IS NULL OR decision NOT IN ('approve','reject','suspend','reactivate')
 OR decision_reason IS NULL OR length(decision_reason)>1000
 OR (decision<>'approve' AND length(btrim(decision_reason))<3) THEN
 RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023'; END IF;
 -- Auth lock follows provisioning's lock order; verification cannot change mid-decision.
 SELECT email_verified INTO verified FROM auth.users WHERE id=target_id FOR UPDATE;
 SELECT approval_status::text INTO current_status FROM app.clergy_profiles WHERE user_id=target_id FOR UPDATE;
 IF current_status IS NULL THEN RAISE EXCEPTION 'Registration not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO previous FROM app.account_approval_events WHERE id=request_id;
 IF FOUND THEN
   IF previous.user_id=target_id AND previous.actor_id=actor AND previous.reason=btrim(decision_reason)
   AND EXISTS (SELECT 1 FROM app.audit_events WHERE correlation_id=request_id AND action='registration.'||decision) THEN
     RETURN request_id;
   END IF;
   RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='23505';
 END IF;
 IF decision='approve' AND current_status='pending' AND verified THEN next_status := 'approved';
 ELSIF decision='reject' AND current_status='pending' THEN next_status := 'rejected';
 ELSIF decision='suspend' AND current_status='approved' THEN next_status := 'suspended';
 ELSIF decision='reactivate' AND current_status='suspended' AND verified
 AND EXISTS (SELECT 1 FROM app.role_assignments WHERE user_id=target_id AND role::text='clergy' AND revoked_at IS NULL)
 THEN next_status := 'approved';
 ELSE RAISE EXCEPTION 'Transition not allowed' USING ERRCODE='22023'; END IF;
 UPDATE app.clergy_profiles SET approval_status=next_status WHERE user_id=target_id;
 INSERT INTO app.account_approval_events(id,user_id,actor_id,status,reason)
 VALUES(request_id,target_id,actor,next_status,btrim(decision_reason));
 INSERT INTO app.audit_events(actor_id,target_user_id,action,outcome,correlation_id)
 VALUES(actor,target_id,'registration.'||decision,'ok',request_id);
 INSERT INTO app.approval_notifications(event_key,user_id,kind)
 VALUES(request_id::text,target_id,CASE decision WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected'
 WHEN 'suspend' THEN 'suspended' ELSE 'reactivated' END);
 RETURN request_id;
END;
$$;
--> statement-breakpoint
-- No runtime EXECUTE: operator-only, exact-ID, one-time, explicit confirmation.
CREATE FUNCTION app.bootstrap_approver(identity_id text, confirmation text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE verified boolean; state text; event_id uuid := gen_random_uuid();
BEGIN
 IF identity_id IS NULL OR confirmation IS DISTINCT FROM 'GRANT APPROVER '||identity_id THEN
 RAISE EXCEPTION 'Explicit identity confirmation required' USING ERRCODE='42501'; END IF;
 LOCK TABLE app.approver_bootstrap IN EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM app.approver_bootstrap) OR EXISTS(
 SELECT 1 FROM app.role_assignments WHERE role::text='approver') THEN
 RAISE EXCEPTION 'Initial approver already established' USING ERRCODE='42501'; END IF;
 SELECT email_verified INTO verified FROM auth.users WHERE id=identity_id FOR UPDATE;
 SELECT approval_status::text INTO state FROM app.clergy_profiles WHERE user_id=identity_id FOR UPDATE;
 IF verified IS DISTINCT FROM true OR state IS NULL OR state NOT IN ('pending','approved')
 OR NOT EXISTS(SELECT 1 FROM app.role_assignments WHERE user_id=identity_id AND role::text='clergy' AND revoked_at IS NULL) THEN
 RAISE EXCEPTION 'Verified registered clergy identity required' USING ERRCODE='42501'; END IF;
 INSERT INTO app.approver_bootstrap(singleton,user_id) VALUES(true,identity_id);
 UPDATE app.clergy_profiles SET approval_status='approved' WHERE user_id=identity_id;
 INSERT INTO app.role_assignments(user_id,role,granted_by) VALUES(identity_id,'approver',identity_id);
 INSERT INTO app.account_approval_events(id,user_id,actor_id,status,reason)
 VALUES(event_id,identity_id,identity_id,'approved','Trusted local operator: initial approver bootstrap');
 INSERT INTO app.audit_events(actor_id,target_user_id,action,outcome,correlation_id)
 VALUES(identity_id,identity_id,'approver.bootstrap','ok',event_id);
 INSERT INTO app.approval_notifications(event_key,user_id,kind) VALUES(event_id::text,identity_id,'approved');
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bootstrap_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON app.approver_bootstrap
FOR EACH STATEMENT EXECUTE FUNCTION app.reject_history_mutation();
--> statement-breakpoint
-- Both orderings are covered: verify after provisioning, or recover profile after verification.
CREATE FUNCTION app.queue_registration_received() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
DECLARE identity_id text;
BEGIN
 IF TG_TABLE_SCHEMA='auth' THEN identity_id := NEW.id; ELSE identity_id := NEW.user_id; END IF;
 IF EXISTS (SELECT 1 FROM auth.users u JOIN app.clergy_profiles p ON p.user_id=u.id
 WHERE u.id=identity_id AND u.email_verified AND p.approval_status='pending') THEN
 INSERT INTO app.approval_notifications(event_key,user_id,kind)
 VALUES('registration:'||identity_id,identity_id,'pending') ON CONFLICT(event_key) DO NOTHING;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER registration_verified AFTER UPDATE OF email_verified ON auth.users
 FOR EACH ROW EXECUTE FUNCTION app.queue_registration_received();
CREATE TRIGGER registration_provisioned AFTER INSERT ON app.clergy_profiles
 FOR EACH ROW EXECUTE FUNCTION app.queue_registration_received();
--> statement-breakpoint
CREATE INDEX notification_due_idx ON app.approval_notifications(available_at) WHERE delivered_at IS NULL;
ALTER TABLE app.approver_bootstrap ADD CONSTRAINT bootstrap_singleton CHECK(singleton);
ALTER TABLE app.approval_notifications ADD CONSTRAINT notification_kind CHECK(kind IN ('pending','approved','rejected','suspended','reactivated'));
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
