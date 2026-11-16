-- Presentation-only owner projection. No job/table access or transition authority.
CREATE FUNCTION app.owner_document_verification(doc uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d app.documents; j app.document_scans;
BEGIN
 IF NOT app.document_account_allowed() THEN RETURN NULL; END IF;
 SELECT x.* INTO d FROM app.documents x JOIN app.submissions s ON s.id=x.submission_id
 WHERE x.id=doc AND s.owner_id=app.request_user_id();
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF d.excluded THEN RETURN 'excluded'; END IF;
 IF app.document_is_clean(doc) THEN RETURN 'ready'; END IF;
 SELECT * INTO j FROM app.document_scans WHERE document_id=doc;
 IF d.state IN ('infected','scan_failed','failed','legacy_unscanned') OR j.state IN ('infected','exhausted','cancelled') THEN RETURN 'unsuccessful'; END IF;
 IF d.state='pending' THEN RETURN 'uploading'; END IF;
 -- An error/retry, stale lease or ten-minute backlog is delayed, never busy.
 IF d.state IN ('quarantined','scanning') AND
 (j.error_category IS NOT NULL OR j.state='scanning' AND (j.lease_until IS NULL OR j.lease_until<=now())
  OR d.created_at<now()-interval '10 minutes') THEN RETURN 'delayed'; END IF;
 -- Bouncer pending remains queued even while a worker submits/polls it.
 IF j.provider='bouncer' AND j.provider_status='scanning' AND j.state IN ('queued','scanning') THEN RETURN 'checking'; END IF;
 IF j.provider='clamav' AND j.state='scanning' AND j.lease_until>now() THEN RETURN 'checking'; END IF;
 IF d.state IN ('quarantined','scanning') AND j.state IN ('queued','scanning') THEN RETURN 'waiting'; END IF;
 RETURN 'unsuccessful';
END $$;
REVOKE ALL ON FUNCTION app.owner_document_verification(uuid) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cape_clergy_runtime') THEN
 GRANT EXECUTE ON FUNCTION app.owner_document_verification(uuid) TO cape_clergy_runtime;
END IF; END $$;
