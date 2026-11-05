-- Checkpoint A: close the direct status/history gap before any reviewer HTTP API.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cape_clergy_runtime') THEN
  REVOKE UPDATE(status) ON app.submissions FROM cape_clergy_runtime;
  REVOKE INSERT(submission_id,reviewer_id,outcome,notes) ON app.review_decisions FROM cape_clergy_runtime;
  REVOKE UPDATE ON app.submissions FROM cape_clergy_runtime;
  REVOKE INSERT ON app.review_decisions FROM cape_clergy_runtime;
 END IF;
END $$;
DROP POLICY submission_review ON app.submissions;
DROP POLICY review_append ON app.review_decisions;
CREATE OR REPLACE FUNCTION app.is_reviewer() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $$
 SELECT app.document_account_allowed()
 AND EXISTS(SELECT 1 FROM app.role_assignments WHERE user_id=app.request_user_id() AND role='clergy' AND revoked_at IS NULL)
 AND EXISTS(SELECT 1 FROM app.role_assignments WHERE user_id=app.request_user_id() AND role='reviewer' AND revoked_at IS NULL)
$$;
CREATE FUNCTION app.can_review_submission(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $$
 SELECT app.is_reviewer() AND EXISTS(
 SELECT 1 FROM app.submissions s JOIN app.reviewer_assignments a ON a.submission_id=s.id AND a.revision=s.revision
 WHERE s.id=target AND s.owner_id<>app.request_user_id() AND a.reviewer_id=app.request_user_id()
 AND a.status='active' AND s.status::text IN ('submitted','under_review','accepted','returned'))
$$;
DROP POLICY submission_read ON app.submissions;
CREATE POLICY submission_read ON app.submissions FOR SELECT USING
 (app.document_account_allowed() AND (owner_id=app.request_user_id() OR app.can_review_submission(id) OR (status::text='accepted' AND NOT confidential)));
DROP POLICY review_read ON app.review_decisions;
CREATE POLICY review_read ON app.review_decisions FOR SELECT USING
 (app.can_review_submission(submission_id) AND revision=(SELECT revision FROM app.submissions WHERE id=submission_id));
CREATE POLICY assignment_read ON app.reviewer_assignments FOR SELECT USING
 (reviewer_id=app.request_user_id() AND app.can_review_submission(submission_id) AND status='active'
 AND revision=(SELECT revision FROM app.submissions WHERE id=submission_id));
-- Document SELECT inherits the now assignment-scoped parent policy. The definer
-- audit helper MUST apply the same predicate itself because it bypasses RLS.
CREATE OR REPLACE FUNCTION app.record_document_access(doc uuid,event text,correlation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE parent uuid; allowed boolean;
BEGIN
 IF event IS NULL OR event NOT IN ('denied','unavailable','authorized','open_failed','started','transfer_failed','cancelled','stream_ended') OR correlation IS NULL
 THEN RAISE EXCEPTION 'Invalid audit event' USING ERRCODE='22023'; END IF;
 SELECT s.id,app.document_account_allowed() AND
 (s.owner_id=app.request_user_id() OR app.can_review_submission(s.id) OR (s.status='accepted' AND NOT s.confidential))
 AND d.state='available' AND (NOT d.excluded OR s.owner_id=app.request_user_id()) INTO parent,allowed
 FROM app.documents d JOIN app.submissions s ON s.id=d.submission_id WHERE d.id=doc;
 IF event IN ('authorized','started') AND NOT coalesce(allowed,false) THEN
 RAISE EXCEPTION 'Document authorization required' USING ERRCODE='42501'; END IF;
 IF event='unavailable' AND parent IS NOT NULL AND NOT coalesce(allowed,false)
 AND EXISTS(SELECT 1 FROM app.documents WHERE id=doc AND state='available') THEN event:='denied'; END IF;
 INSERT INTO app.audit_events(actor_id,submission_id,document_id,action,outcome,correlation_id)
 VALUES(app.request_user_id(),parent,doc,'document.download.'||event,
 CASE WHEN event='denied' THEN 'denied'::app.audit_outcome WHEN event IN ('unavailable','open_failed','transfer_failed') THEN 'error'::app.audit_outcome ELSE 'ok'::app.audit_outcome END,correlation);
END $$;
REVOKE ALL ON FUNCTION app.can_review_submission(uuid) FROM PUBLIC;
