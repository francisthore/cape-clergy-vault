-- Trusted-server boundary only: custom GUCs are NOT proof of identity.
-- Functions run as migration owner to inspect live authorization rows without
-- recursive RLS. No dynamic SQL, fixed search_path, no PUBLIC execution.
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION app.request_user_id() RETURNS text LANGUAGE sql STABLE
SET search_path = pg_catalog AS $$
  SELECT nullif(current_setting('cape.user_id', true), '')
$$;
--> statement-breakpoint
CREATE FUNCTION app.is_active() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT 1 FROM app.clergy_profiles p
    WHERE p.user_id = app.request_user_id() AND p.approval_status = 'approved')
$$;
--> statement-breakpoint
CREATE FUNCTION app.is_reviewer() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT app.is_active() AND EXISTS (SELECT 1 FROM app.role_assignments r
    WHERE r.user_id = app.request_user_id() AND r.revoked_at IS NULL
    AND r.role::text IN ('reviewer', 'admin'))
$$;
--> statement-breakpoint
CREATE FUNCTION app.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT app.is_active() AND EXISTS (SELECT 1 FROM app.role_assignments r
    WHERE r.user_id = app.request_user_id() AND r.revoked_at IS NULL AND r.role::text = 'admin')
$$;
--> statement-breakpoint
-- Version literals deliberately maintained by migrations, never request settings.
CREATE FUNCTION app.has_consent(purpose text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT app.is_active() AND coalesce((SELECT e.action = 'accepted'
    FROM app.popia_consent_events e WHERE e.user_id = app.request_user_id()
    AND e.purpose::text = $1
    ORDER BY e.created_at DESC, e.id DESC LIMIT 1), false)
    AND coalesce((SELECT e.notice_version = CASE $1
      WHEN 'repository' THEN 'repository-v1' WHEN 'private_chat' THEN 'private-chat-v1' END
    FROM app.popia_consent_events e WHERE e.user_id = app.request_user_id()
    AND e.purpose::text = $1 ORDER BY e.created_at DESC, e.id DESC LIMIT 1), false)
$$;
--> statement-breakpoint
CREATE FUNCTION app.can_chat(owner_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT app.has_consent('private_chat')
    AND ($1 = app.request_user_id() OR app.is_reviewer())
    AND EXISTS (SELECT 1 FROM app.clergy_profiles p WHERE p.user_id = $1 AND p.approval_status = 'approved')
    AND coalesce((SELECT e.action = 'accepted' AND e.notice_version = 'private-chat-v1'
      FROM app.popia_consent_events e WHERE e.user_id = $1 AND e.purpose = 'private_chat'
      ORDER BY e.created_at DESC, e.id DESC LIMIT 1), false)
$$;
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY profile_read ON app.clergy_profiles FOR SELECT
  USING (user_id = app.request_user_id() OR app.is_admin());
CREATE POLICY approval_read ON app.account_approval_events FOR SELECT
  USING (app.is_active() AND (user_id = app.request_user_id() OR app.is_admin()));
CREATE POLICY role_read ON app.role_assignments FOR SELECT
  USING (app.is_active() AND (user_id = app.request_user_id() OR app.is_admin()));
CREATE POLICY consent_read ON app.popia_consent_events FOR SELECT
  USING (user_id = app.request_user_id());
CREATE POLICY consent_append ON app.popia_consent_events FOR INSERT
  WITH CHECK (user_id = app.request_user_id() AND EXISTS
    (SELECT 1 FROM app.clergy_profiles p WHERE p.user_id = app.request_user_id()
      AND p.approval_status IN ('pending', 'approved'))
    AND notice_version = CASE purpose WHEN 'repository' THEN 'repository-v1' ELSE 'private-chat-v1' END);
--> statement-breakpoint
CREATE POLICY submission_read ON app.submissions FOR SELECT
  USING (app.has_consent('repository') AND
    (owner_id = app.request_user_id() OR app.is_reviewer() OR (status = 'accepted' AND NOT confidential)));
CREATE POLICY submission_create ON app.submissions FOR INSERT
  WITH CHECK (app.has_consent('repository') AND owner_id = app.request_user_id() AND status = 'submitted');
CREATE POLICY submission_review ON app.submissions FOR UPDATE
  USING (app.has_consent('repository') AND app.is_reviewer())
  WITH CHECK (app.has_consent('repository') AND app.is_reviewer());
--> statement-breakpoint
CREATE POLICY document_read ON app.documents FOR SELECT
  USING (EXISTS (SELECT 1 FROM app.submissions s WHERE s.id = submission_id));
CREATE POLICY document_create ON app.documents FOR INSERT
  WITH CHECK (app.has_consent('repository')
    AND starts_with(storage_key, app.request_user_id() || '/')
    AND EXISTS (SELECT 1 FROM app.submissions s WHERE s.id = submission_id
      AND s.owner_id = app.request_user_id() AND s.status = 'submitted'));
CREATE POLICY review_read ON app.review_decisions FOR SELECT
  USING (app.has_consent('repository') AND EXISTS (SELECT 1 FROM app.submissions s
    WHERE s.id = submission_id AND (s.owner_id = app.request_user_id() OR app.is_reviewer())));
CREATE POLICY review_append ON app.review_decisions FOR INSERT
  WITH CHECK (app.has_consent('repository') AND app.is_reviewer()
    AND reviewer_id = app.request_user_id()
    AND EXISTS (SELECT 1 FROM app.submissions s WHERE s.id = submission_id));
--> statement-breakpoint
CREATE POLICY chat_read ON app.chat_messages FOR SELECT USING (app.can_chat(owner_id));
CREATE POLICY chat_append ON app.chat_messages FOR INSERT
  WITH CHECK (app.can_chat(owner_id) AND sender_id = app.request_user_id());
CREATE POLICY mute_read ON app.chat_notification_preferences FOR SELECT
  USING (user_id = app.request_user_id() AND app.can_chat(owner_id));
CREATE POLICY mute_create ON app.chat_notification_preferences FOR INSERT
  WITH CHECK (user_id = app.request_user_id() AND app.can_chat(owner_id));
CREATE POLICY mute_update ON app.chat_notification_preferences FOR UPDATE
  USING (user_id = app.request_user_id() AND app.can_chat(owner_id))
  WITH CHECK (user_id = app.request_user_id() AND app.can_chat(owner_id));
--> statement-breakpoint
CREATE POLICY audit_read ON app.audit_events FOR SELECT USING (app.is_admin());
CREATE POLICY audit_append ON app.audit_events FOR INSERT
  WITH CHECK (app.is_active() AND actor_id = app.request_user_id());
