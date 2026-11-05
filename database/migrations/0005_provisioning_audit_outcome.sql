-- Forward correction: audit_outcome is ok/denied/error; approval remains pending.
-- Trusted server calls only, using a Better Auth-created identity or verified session.
-- Like the existing context boundary, this cannot resist stolen runtime credentials.
CREATE OR REPLACE FUNCTION app.provision_clergy(identity_id text, full_name text, title text,
  parish text, phone text, acknowledged boolean, notice_version text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE inserted_id text;
BEGIN
  IF identity_id IS DISTINCT FROM app.request_user_id() OR identity_id IS NULL
    OR acknowledged IS DISTINCT FROM true OR notice_version IS DISTINCT FROM 'repository-v1'
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
    VALUES (identity_id, 'repository-v1', 'repository', 'accepted');
  INSERT INTO app.audit_events(actor_id, target_user_id, action, outcome)
    VALUES (identity_id, identity_id, 'registration.provision', 'ok');
END;
$$;
