-- One record must satisfy every assignment predicate. Never combine assignments.
CREATE FUNCTION app.assignment_notification_allowed(notification uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.reviewer_notifications n
 JOIN app.reviewer_assignments a ON a.id=n.assignment_id
 JOIN app.submissions s ON s.id=a.submission_id
 WHERE n.id=notification AND n.kind='review_assigned' AND n.cancelled_at IS NULL AND n.delivered_at IS NULL
 AND n.user_id=app.request_user_id() AND a.reviewer_id=n.user_id AND a.submission_id=n.submission_id
 AND a.status='active' AND a.revision=s.revision
 AND s.status::text IN ('submitted','under_review') AND app.can_review_submission(s.id))
$$;
REVOKE ALL ON FUNCTION app.assignment_notification_allowed(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION app.cancel_assignment_notifications() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='reviewer_assignments' THEN
  IF NEW.status='revoked' THEN
   UPDATE app.reviewer_notifications SET cancelled_at=now(),lease_token=NULL,last_error='assignment_revoked'
   WHERE assignment_id=NEW.id AND kind='review_assigned' AND delivered_at IS NULL AND cancelled_at IS NULL;
  END IF;
 ELSE
  IF NEW.revision<>OLD.revision OR NEW.status::text NOT IN ('submitted','under_review') THEN
   UPDATE app.reviewer_notifications n SET cancelled_at=now(),lease_token=NULL,last_error='assignment_superseded'
   WHERE n.submission_id=NEW.id AND n.kind='review_assigned' AND n.delivered_at IS NULL AND n.cancelled_at IS NULL
   AND (NEW.status::text NOT IN ('submitted','under_review') OR EXISTS
    (SELECT 1 FROM app.reviewer_assignments a WHERE a.id=n.assignment_id AND a.revision<>NEW.revision));
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assignment_notification_revoked AFTER UPDATE OF status ON app.reviewer_assignments
 FOR EACH ROW EXECUTE FUNCTION app.cancel_assignment_notifications();
CREATE TRIGGER assignment_notification_superseded AFTER UPDATE OF revision,status ON app.submissions
 FOR EACH ROW EXECUTE FUNCTION app.cancel_assignment_notifications();
CREATE FUNCTION app.audit_reviewer_notification_cancel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL THEN
  INSERT INTO app.audit_events(target_user_id,submission_id,action,outcome,correlation_id)
  VALUES(NEW.user_id,NEW.submission_id,'reviewer.notification_cancelled','ok',NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reviewer_notification_cancellation AFTER UPDATE OF cancelled_at ON app.reviewer_notifications
 FOR EACH ROW EXECUTE FUNCTION app.audit_reviewer_notification_cancel();
REVOKE ALL ON FUNCTION app.cancel_assignment_notifications(),app.audit_reviewer_notification_cancel() FROM PUBLIC;
