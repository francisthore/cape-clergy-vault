-- New proposed notice records a distinct content revision. Legacy acknowledgements
-- retain their exact identifier and local eligibility; no historical rows are rewritten.
CREATE OR REPLACE FUNCTION app.provision_clergy(identity_id text, full_name text, title text,
  parish text, phone text, acknowledged boolean, notice_version text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE inserted_id text;
BEGIN
  IF identity_id IS DISTINCT FROM app.request_user_id() OR identity_id IS NULL
    OR acknowledged IS DISTINCT FROM true OR notice_version IS DISTINCT FROM 'repository-v1-proposed-2026-11-16'
    OR length(btrim(full_name)) NOT BETWEEN 2 AND 120
    OR length(btrim(title)) NOT BETWEEN 1 AND 40
    OR length(btrim(parish)) NOT BETWEEN 2 AND 120
    OR phone IS NULL OR length(phone) > 30
    OR full_name IS NULL OR title IS NULL OR parish IS NULL THEN
    RAISE EXCEPTION 'Invalid provisioning request' USING ERRCODE = '42501';
  END IF;
  -- Serialize on the auth identity. Repeated/concurrent calls cannot overwrite a
  -- profile, reinstate revoked roles, or append duplicate registration history.
  PERFORM 1 FROM auth.users WHERE id = identity_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Identity required' USING ERRCODE = '42501'; END IF;
  INSERT INTO app.clergy_profiles(user_id, full_name, title, parish, phone, approval_status)
    VALUES (identity_id, btrim(full_name), btrim(title), btrim(parish), phone, 'pending')
    ON CONFLICT (user_id) DO NOTHING RETURNING user_id INTO inserted_id;
  IF inserted_id IS NULL THEN RETURN; END IF;
  INSERT INTO app.role_assignments(user_id, role) VALUES (identity_id, 'clergy');
  INSERT INTO app.account_approval_events(user_id, actor_id, status, reason)
    VALUES (identity_id, identity_id, 'pending', 'registration');
  INSERT INTO app.popia_consent_events(user_id, notice_version, purpose, action)
    VALUES (identity_id, notice_version, 'repository', 'accepted');
  INSERT INTO app.audit_events(actor_id, target_user_id, action, outcome)
    VALUES (identity_id, identity_id, 'registration.provision', 'ok');
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.has_consent(purpose text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT app.is_active() AND coalesce((SELECT e.action = 'accepted'
    FROM app.popia_consent_events e WHERE e.user_id = app.request_user_id()
    AND e.purpose::text = $1
    ORDER BY e.created_at DESC, e.id DESC LIMIT 1), false)
    AND coalesce((SELECT CASE $1
      WHEN 'repository' THEN e.notice_version IN ('repository-v1','repository-v1-proposed-2026-11-16')
      WHEN 'private_chat' THEN e.notice_version='private-chat-v1' ELSE false END
    FROM app.popia_consent_events e WHERE e.user_id = app.request_user_id()
    AND e.purpose::text = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 1), false)
$$;

DROP POLICY consent_append ON app.popia_consent_events;
CREATE POLICY consent_append ON app.popia_consent_events FOR INSERT WITH CHECK
 (user_id=app.request_user_id() AND EXISTS (SELECT 1 FROM app.clergy_profiles p
 WHERE p.user_id=app.request_user_id() AND p.approval_status IN ('pending','approved'))
 AND CASE purpose::text WHEN 'repository' THEN (notice_version='repository-v1-proposed-2026-11-16'
   OR (notice_version='repository-v1' AND action='withdrawn'))
 WHEN 'private_chat' THEN notice_version='private-chat-v1' ELSE false END);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.reviewer_operator(action text,identity text,subject uuid,digest text,sealed text,confirmation text,expected_revision integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actual integer;
BEGIN
 IF session_user<>'cape_clergy_dev' OR confirmation IS DISTINCT FROM (upper(action)||' '||identity||coalesce(' '||subject::text,'')||
 CASE WHEN action='assign' THEN ' REVISION '||expected_revision::text ELSE '' END)
 THEN RAISE EXCEPTION 'Trusted operator confirmation required' USING ERRCODE='42501'; END IF;
 IF action='assign' THEN
  -- Same lock order as invitation/revocation and review operations.
  PERFORM 1 FROM auth.users WHERE id=identity FOR UPDATE;
  SELECT revision INTO actual FROM app.submissions WHERE id=subject FOR UPDATE;
  IF expected_revision IS NULL OR actual IS DISTINCT FROM expected_revision THEN
   RAISE EXCEPTION 'Assignment revision changed' USING ERRCODE='40001'; END IF;
  IF NOT coalesce((SELECT e.action='accepted' AND e.notice_version IN ('repository-v1','repository-v1-proposed-2026-11-16') FROM app.popia_consent_events e
    WHERE e.user_id=identity AND e.purpose='repository' ORDER BY e.created_at DESC,e.id DESC LIMIT 1),false)
  THEN RAISE EXCEPTION 'Current reviewer consent required' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN app.reviewer_operator_internal(action,identity,subject,digest,sealed,upper(action)||' '||identity||coalesce(' '||subject::text,''));
END $$;
REVOKE ALL ON FUNCTION app.reviewer_operator(text,text,uuid,text,text,text,integer) FROM PUBLIC;

--> statement-breakpoint
-- Extend the existing outbox; no new delivery system or fallback recipients.
ALTER TABLE app.approval_notifications DROP CONSTRAINT notification_kind;
ALTER TABLE app.approval_notifications ADD CONSTRAINT notification_kind CHECK
 (kind IN ('pending','approved','rejected','suspended','reactivated','registration_pending_alert'));

CREATE OR REPLACE FUNCTION app.queue_registration_received() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity_id text; received uuid; recipients integer;
BEGIN
 IF TG_TABLE_SCHEMA='auth' THEN identity_id:=NEW.id; ELSE identity_id:=NEW.user_id; END IF;
 IF EXISTS(SELECT 1 FROM auth.users u JOIN app.clergy_profiles p ON p.user_id=u.id
 WHERE u.id=identity_id AND u.email_verified AND p.approval_status='pending') THEN
  INSERT INTO app.approval_notifications(event_key,user_id,kind)
   VALUES('registration:'||identity_id,identity_id,'pending') ON CONFLICT(event_key) DO NOTHING
   RETURNING id INTO received;
  -- The first newly committed verified/pending intent is the event. Re-verification
  -- and existing registrations do not fan out again, including after zero recipients.
  IF received IS NOT NULL THEN
   INSERT INTO app.approval_notifications(event_key,user_id,kind)
    SELECT 'registration-alert:'||received::text||':'||u.id,u.id,'registration_pending_alert'
    FROM auth.users u JOIN app.clergy_profiles p ON p.user_id=u.id
    WHERE u.email_verified AND p.approval_status='approved'
    AND EXISTS(SELECT 1 FROM app.role_assignments r WHERE r.user_id=u.id
      AND r.role::text='approver' AND r.revoked_at IS NULL);
   GET DIAGNOSTICS recipients=ROW_COUNT;
   INSERT INTO app.audit_events(target_user_id,action,outcome,correlation_id)
    VALUES(identity_id,CASE WHEN recipients=0 THEN 'registration.approver_alert_no_recipients'
      ELSE 'registration.approver_alert_queued' END,'ok',received);
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- Delegate unchanged reviewer/outcome eligibility to its reviewed implementation.
ALTER FUNCTION app.notification_eligible(text,uuid) RENAME TO notification_eligible_before_phase42;
CREATE FUNCTION app.notification_eligible(queue text,notification uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n app.approval_notifications;
BEGIN
 IF queue='approval' THEN
  SELECT * INTO n FROM app.approval_notifications WHERE id=notification;
  IF n.kind='registration_pending_alert' THEN
   RETURN n.cancelled_at IS NULL AND n.delivered_at IS NULL AND EXISTS(
    SELECT 1 FROM auth.users u JOIN app.clergy_profiles p ON p.user_id=u.id
    WHERE u.id=n.user_id AND u.email_verified AND p.approval_status='approved'
    AND (n.recipient_email IS NULL OR n.recipient_email=u.email)
    AND EXISTS(SELECT 1 FROM app.role_assignments r WHERE r.user_id=u.id
      AND r.role::text='approver' AND r.revoked_at IS NULL));
  END IF;
 END IF;
 RETURN app.notification_eligible_before_phase42(queue,notification);
END $$;
REVOKE ALL ON FUNCTION app.notification_eligible(text,uuid),app.notification_eligible_before_phase42(text,uuid),
 app.queue_registration_received() FROM PUBLIC;
-- Internal helpers remain unavailable to runtime and notification logins. Existing
-- claim/prepare/check/finish grants and leases apply without new role privileges.
