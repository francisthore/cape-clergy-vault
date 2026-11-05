-- The operator must confirm the revision inspected before the terminal prompt.
-- Prevent an author amendment between inspection and confirmation silently moving
-- the assignment to another revision. Keep the initial implementation owner-only.
ALTER FUNCTION app.reviewer_operator(text,text,uuid,text,text,text) RENAME TO reviewer_operator_internal;
CREATE FUNCTION app.reviewer_operator(action text,identity text,subject uuid,digest text,sealed text,confirmation text,expected_revision integer) RETURNS uuid
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
  IF NOT coalesce((SELECT e.action='accepted' AND e.notice_version='repository-v1' FROM app.popia_consent_events e
    WHERE e.user_id=identity AND e.purpose='repository' ORDER BY e.created_at DESC,e.id DESC LIMIT 1),false)
  THEN RAISE EXCEPTION 'Current reviewer consent required' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN app.reviewer_operator_internal(action,identity,subject,digest,sealed,upper(action)||' '||identity||coalesce(' '||subject::text,''));
END $$;
REVOKE ALL ON FUNCTION app.reviewer_operator(text,text,uuid,text,text,text,integer) FROM PUBLIC;
