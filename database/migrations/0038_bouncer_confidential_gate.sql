-- Phase 4.3 audit remediation (additive forward migration; 0034 is untouched).
-- Finding: the Bouncer claim/reserve path did not consider submissions.confidential, so a confidential
-- resource's PDF could be newly transferred to the external provider although external processing of
-- confidential material is unapproved. Fail closed: confidential documents are not claimed or reserved
-- for Bouncer. They remain quarantined and unverified (never clean) until a separately approved route
-- (for example a local scanner) exists. Provider-accepted work continues polling; transferred bytes
-- cannot be recalled. CREATE OR REPLACE keeps the existing owner and reviewed EXECUTE grants.
CREATE OR REPLACE FUNCTION app.claim_bouncer_scan(only_doc uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.document_scans; d app.documents; rev integer; token uuid:=gen_random_uuid();
BEGIN
 PERFORM app.require_scanner_worker();
 IF NOT pg_try_advisory_xact_lock(313006,1) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM app.document_scans WHERE state='scanning' AND lease_until>now()) THEN RETURN NULL; END IF;
 -- Count crashed pre-submission and poll leases too; restart cannot create an unbounded loop.
 WITH stopped AS (
  UPDATE app.document_scans SET state='exhausted',provider_status='held',result_category='lease_exhausted',
   error_category='lease_exhausted',completed_at=now(),lease_token=NULL,lease_until=NULL
  WHERE provider='bouncer' AND state='scanning' AND lease_until<=now() AND provider_status<>'submitting'
   AND (external_scan_id IS NULL AND attempts>=5 OR external_scan_id IS NOT NULL AND (poll_count>=120 OR submitted_at<now()-interval '2 hours'))
  RETURNING document_id,attempts,correlation_id)
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id)
  SELECT document_id,attempts,'bouncer.lease_exhausted',correlation_id FROM stopped;
 UPDATE app.documents SET state='scan_failed' WHERE state='scanning' AND id IN
  (SELECT document_id FROM app.document_scans WHERE provider='bouncer' AND state='exhausted');
 SELECT q.* INTO j FROM app.document_scans q JOIN app.documents x ON x.id=q.document_id
 WHERE (q.state='queued' AND q.available_at<=now() OR q.state='scanning' AND q.lease_until<=now())
 AND (q.provider='bouncer' OR q.provider='clamav' AND q.attempts=0)
 AND (only_doc IS NULL OR q.document_id=only_doc) AND x.state IN ('quarantined','scanning')
 -- One external scan in flight across all processes, including between poll leases.
 AND NOT EXISTS(SELECT 1 FROM app.document_scans other WHERE other.provider='bouncer'
   AND other.document_id<>q.document_id AND other.state IN ('queued','scanning')
   AND (other.external_scan_id IS NOT NULL OR other.provider_status='submitting'))
 AND (q.external_scan_id IS NOT NULL OR q.provider_status='submitting' OR NOT EXISTS(
   SELECT 1 FROM app.scanner_budget b WHERE b.period=to_char(now() AT TIME ZONE 'UTC','YYYY-MM') AND b.blocked_until>now()))
 -- Phase 4.3: confidential resources are never newly transferred to the external provider.
 -- Work already accepted by the provider (scan ID / submission marker) keeps polling.
 AND (q.external_scan_id IS NOT NULL OR q.provider_status='submitting' OR NOT EXISTS(
   SELECT 1 FROM app.submissions c WHERE c.id=x.submission_id AND c.confidential))
 ORDER BY (q.external_scan_id IS NOT NULL) DESC,q.available_at,q.document_id
 FOR UPDATE OF x,q SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT revision INTO rev FROM app.submissions WHERE id=(SELECT submission_id FROM app.documents WHERE id=j.document_id);
 UPDATE app.document_scans SET provider='bouncer',state='scanning',attempts=least(5,attempts+CASE WHEN external_scan_id IS NULL THEN 1 ELSE 0 END),
 expected_byte_size=coalesce(expected_byte_size,(SELECT byte_size FROM app.documents WHERE id=j.document_id)),
 submission_revision=coalesce(submission_revision,rev),started_at=coalesce(started_at,now()),completed_at=NULL,
 poll_count=least(120,poll_count+CASE WHEN external_scan_id IS NOT NULL THEN 1 ELSE 0 END),
 lease_token=token,lease_until=now()+interval '5 minutes' WHERE document_id=j.document_id RETURNING * INTO j;
 UPDATE app.documents SET state='scanning' WHERE id=j.document_id RETURNING * INTO d;
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id) VALUES(d.id,j.attempts,'bouncer.claimed',j.correlation_id);
 RETURN jsonb_build_object('documentId',d.id,'storageKey',d.storage_key,'sha256',j.expected_sha256,'byteSize',j.expected_byte_size,
 'lease',token,'attempt',j.attempts,'correlationId',j.correlation_id,'externalScanId',j.external_scan_id,'providerStatus',j.provider_status);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.reserve_bouncer_scan(doc uuid,token uuid,used integer,quota integer,period_value text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.document_scans; d app.documents; s app.submissions; reserved_count integer;
BEGIN
 PERFORM app.require_scanner_worker();
 SELECT p.* INTO s FROM app.submissions p JOIN app.documents x ON x.submission_id=p.id WHERE x.id=doc FOR SHARE OF p;
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
 UPDATE app.scanner_budget SET reserved=greatest(reserved_count,used)+1,observed_used=used,updated_at=now() WHERE period=period_value;
 UPDATE app.document_scans SET provider_status='submitting',submitted_at=now() WHERE document_id=doc;
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id) VALUES(doc,j.attempts,'bouncer.submitting',j.correlation_id);
 RETURN true;
END $$;
