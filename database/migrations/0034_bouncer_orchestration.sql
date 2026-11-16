CREATE TABLE "app"."scanner_budget" (
	"period" text PRIMARY KEY NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"observed_used" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scanner_budget_bounds" CHECK ("app"."scanner_budget"."reserved" between 0 and 500 and "app"."scanner_budget"."observed_used" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."scanner_budget" ENABLE ROW LEVEL SECURITY;
-- All provider I/O takes place AFTER these short transactions commit.
CREATE FUNCTION app.claim_bouncer_scan(only_doc uuid DEFAULT NULL) RETURNS jsonb
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

CREATE FUNCTION app.reserve_bouncer_scan(doc uuid,token uuid,used integer,quota integer,period_value text) RETURNS boolean
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
 OR NOT app.document_account_allowed() THEN RAISE EXCEPTION 'Scan ineligible' USING ERRCODE='42501'; END IF;
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

CREATE FUNCTION app.accept_bouncer_scan(doc uuid,token uuid,scan_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.document_scans;
BEGIN
 PERFORM app.require_scanner_worker();
 IF scan_id IS NULL OR scan_id !~ '^scan_[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'Invalid scan ID' USING ERRCODE='22023'; END IF;
 SELECT * INTO j FROM app.document_scans WHERE document_id=doc FOR UPDATE;
 IF j.document_id IS NULL OR j.provider<>'bouncer' OR j.state<>'scanning' OR j.lease_token IS DISTINCT FROM token OR j.lease_until<=now()
 OR j.external_scan_id IS NOT NULL OR j.provider_status<>'submitting' THEN RETURN false; END IF;
 UPDATE app.document_scans SET external_scan_id=scan_id,provider_status='pending' WHERE document_id=doc;
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id) VALUES(doc,j.attempts,'bouncer.accepted',j.correlation_id);
 RETURN true;
END $$;

CREATE FUNCTION app.finish_bouncer_scan(doc uuid,token uuid,scan_id text,result text,checksum text,reported_hash text,reported_size bigint,polled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.document_scans; d app.documents; s app.submissions; next_state text; next_status text; failures integer; delay_until timestamptz; event_name text;
BEGIN
 PERFORM app.require_scanner_worker();
 SELECT p.* INTO s FROM app.submissions p JOIN app.documents x ON x.submission_id=p.id WHERE x.id=doc FOR SHARE OF p;
 SELECT * INTO d FROM app.documents WHERE id=doc FOR UPDATE;
 SELECT * INTO j FROM app.document_scans WHERE document_id=doc FOR UPDATE;
 IF j.document_id IS NULL OR j.provider<>'bouncer' OR j.state<>'scanning' OR j.lease_token IS DISTINCT FROM token OR j.lease_until<=now() THEN RETURN false; END IF;
 IF result IS NULL OR result NOT IN ('submitted','pending','scanning','clean','malicious','suspicious','failed','quota','unavailable','timeout','invalid_response','unsafe_destination','integrity_mismatch','object_missing','ambiguous','ineligible') THEN result:='invalid_response'; END IF;
 IF scan_id IS DISTINCT FROM j.external_scan_id OR (result IN ('clean','malicious','suspicious','pending','scanning','submitted') AND j.external_scan_id IS NULL)
 OR (result IN ('clean','malicious','suspicious') AND polled IS DISTINCT FROM true) THEN result:='invalid_response'; END IF;
 IF result IN ('clean','malicious','suspicious') AND (checksum IS NULL OR reported_hash IS NULL OR reported_size IS NULL OR
 checksum IS DISTINCT FROM j.expected_sha256 OR checksum IS DISTINCT FROM d.sha256 OR reported_hash IS DISTINCT FROM j.expected_sha256
 OR reported_size IS DISTINCT FROM j.expected_byte_size OR reported_size IS DISTINCT FROM d.byte_size OR d.state<>'scanning') THEN result:='integrity_mismatch'; END IF;
 -- Preserve verified infection evidence when revocation occurs during provider I/O.
 PERFORM set_config('cape.user_id',s.owner_id,true);
 IF result<>'malicious' AND (d.excluded OR s.kind<>'document' OR s.revision IS DISTINCT FROM j.submission_revision OR NOT app.document_account_allowed()) THEN result:='ineligible'; END IF;
 IF j.provider_status='submitting' AND j.external_scan_id IS NULL AND result<>'quota' THEN result:='ambiguous'; END IF;
 event_name:=result;
 failures:=j.failure_count;
 next_state:='queued'; next_status:=j.provider_status;
 delay_until:=now()+interval '30 seconds';
 IF result='clean' THEN next_state:='clean'; next_status:='completed';
 ELSIF result='malicious' THEN next_state:='infected'; next_status:='completed';
 ELSIF result='suspicious' THEN next_state:='exhausted';next_status:='completed';
 ELSIF result IN ('ambiguous','integrity_mismatch','object_missing','unsafe_destination','ineligible','failed','invalid_response') THEN
  next_state:=CASE WHEN result='ineligible' THEN 'cancelled' ELSE 'exhausted' END;
  next_status:=CASE WHEN result='ambiguous' THEN 'ambiguous' ELSE 'held' END;
 ELSIF result='quota' THEN
  delay_until:=(date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC';
  IF j.external_scan_id IS NULL THEN next_status:='new'; END IF;
  INSERT INTO app.scanner_budget(period,blocked_until) VALUES(to_char(now() AT TIME ZONE 'UTC','YYYY-MM'),delay_until)
   ON CONFLICT(period) DO UPDATE SET blocked_until=excluded.blocked_until,updated_at=now();
 ELSIF result IN ('timeout','unavailable') THEN
  failures:=least(5,failures+1);
  delay_until:=now()+least(3600,30*power(2,failures))*interval '1 second';
  IF failures>=5 THEN next_state:='exhausted';next_status:='held'; END IF;
 ELSIF result IN ('pending','scanning') THEN next_status:=result; failures:=0;
 ELSIF result='submitted' THEN next_status:='pending';
 END IF;
 IF next_state='queued' AND (j.poll_count>=120 OR
    j.submitted_at<now()-interval '2 hours') THEN next_state:='exhausted';next_status:='held';event_name:='poll_exhausted'; END IF;
 UPDATE app.documents SET state=CASE next_state WHEN 'clean' THEN 'available' WHEN 'infected' THEN 'infected'
  WHEN 'queued' THEN 'quarantined' ELSE 'scan_failed' END WHERE id=doc;
 UPDATE app.document_scans SET state=next_state,provider_status=next_status,result_category=event_name,
  scanned_sha256=CASE WHEN checksum ~ '^[0-9a-f]{64}$' THEN checksum ELSE NULL END,
  provider_sha256=CASE WHEN reported_hash ~ '^[0-9a-f]{64}$' THEN reported_hash ELSE NULL END,provider_byte_size=reported_size,
  failure_count=failures,
  last_poll_at=CASE WHEN polled THEN now() ELSE last_poll_at END,
  completed_at=CASE WHEN next_state<>'queued' THEN now() ELSE NULL END,
  error_category=CASE WHEN result IN ('clean','malicious','pending','scanning','submitted') THEN NULL ELSE event_name END,
  lease_token=NULL,lease_until=NULL,available_at=delay_until WHERE document_id=doc;
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id) VALUES(doc,j.attempts,'bouncer.'||event_name,j.correlation_id);
 INSERT INTO app.audit_events(document_id,submission_id,action,outcome,correlation_id)
 VALUES(doc,d.submission_id,'document.scan.bouncer.'||event_name,CASE WHEN result='clean' THEN 'ok'::app.audit_outcome ELSE 'error'::app.audit_outcome END,j.correlation_id);
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION app.claim_bouncer_scan(uuid),app.reserve_bouncer_scan(uuid,uuid,integer,integer,text),
 app.accept_bouncer_scan(uuid,uuid,text),app.finish_bouncer_scan(uuid,uuid,text,text,text,text,bigint,boolean) FROM PUBLIC;
REVOKE ALL ON app.scanner_budget FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cape_clergy_scanner') THEN
 GRANT EXECUTE ON FUNCTION app.claim_bouncer_scan(uuid),app.reserve_bouncer_scan(uuid,uuid,integer,integer,text),
 app.accept_bouncer_scan(uuid,uuid,text),app.finish_bouncer_scan(uuid,uuid,text,text,text,text,bigint,boolean) TO cape_clergy_scanner;
END IF; END $$;

CREATE OR REPLACE FUNCTION app.claim_document_scan_internal(only_doc uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.document_scans; d app.documents; token uuid:=gen_random_uuid();
BEGIN
 PERFORM app.require_scanner_worker();
 -- Expired final attempts remain visibly exhausted; a crash never creates clean evidence.
 WITH exhausted AS (UPDATE app.document_scans SET state='exhausted',lease_token=NULL,lease_until=NULL,
 error_category='lease_exhausted',completed_at=now() WHERE provider='clamav' AND state='scanning' AND lease_until<=now() AND attempts>=5
 RETURNING document_id,attempts,correlation_id)
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id)
 SELECT document_id,attempts,'lease_exhausted',correlation_id FROM exhausted;
 UPDATE app.documents SET state='scan_failed' WHERE state='scanning' AND id IN(SELECT document_id FROM app.document_scans WHERE state='exhausted');
 SELECT q.* INTO j FROM app.document_scans q JOIN app.documents x ON x.id=q.document_id
 WHERE (q.state='queued' AND q.available_at<=now() OR q.state='scanning' AND q.lease_until<=now())
 AND q.provider='clamav' AND q.attempts<5 AND (only_doc IS NULL OR q.document_id=only_doc)
 AND x.state IN ('quarantined','scanning') ORDER BY q.available_at,q.document_id FOR UPDATE OF x,q SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE app.document_scans SET state='scanning',attempts=attempts+1,started_at=now(),completed_at=NULL,
 lease_token=token,lease_until=now()+interval '5 minutes',correlation_id=gen_random_uuid() WHERE document_id=j.document_id RETURNING * INTO j;
 UPDATE app.documents SET state='scanning' WHERE id=j.document_id RETURNING * INTO d;
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id) VALUES(d.id,j.attempts,'started',j.correlation_id);
 RETURN jsonb_build_object('documentId',d.id,'storageKey',d.storage_key,'sha256',j.expected_sha256,'byteSize',d.byte_size,
 'lease',token,'attempt',j.attempts,'correlationId',j.correlation_id);
END $$;
CREATE OR REPLACE FUNCTION app.finish_document_scan(doc uuid,token uuid,verdict text,checksum text,engine_value text,definitions_value text,definitions_time timestamptz,error_value text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j app.document_scans; d app.documents; s app.submissions; event_name text;
BEGIN
 PERFORM app.require_scanner_worker();
 SELECT p.* INTO s FROM app.submissions p JOIN app.documents x ON x.submission_id=p.id WHERE x.id=doc FOR SHARE OF p;
 SELECT * INTO d FROM app.documents WHERE id=doc FOR UPDATE;
 SELECT * INTO j FROM app.document_scans WHERE document_id=doc FOR UPDATE;
 IF j.document_id IS NULL OR j.provider<>'clamav' OR j.state<>'scanning' OR j.lease_token IS DISTINCT FROM token OR j.lease_until<=now() THEN RETURN false; END IF;
 IF verdict IS NULL OR verdict NOT IN ('clean','infected','error','unavailable') THEN verdict:='error'; error_value:='invalid_response'; END IF;
 IF error_value IS NOT NULL AND error_value NOT IN ('unavailable','timeout','disconnected','invalid_response','size_limit','definitions_missing','definitions_stale','integrity_mismatch','object_missing','storage_error','scanner_error','ineligible')
 THEN error_value:='scanner_error'; END IF;
 IF verdict IN ('clean','infected') AND (checksum IS DISTINCT FROM j.expected_sha256 OR checksum IS DISTINCT FROM d.sha256 OR d.state<>'scanning')
 THEN verdict:='error';error_value:='integrity_mismatch'; END IF;
 IF verdict='clean' AND (engine_value IS NULL OR length(engine_value) NOT BETWEEN 1 AND 128 OR definitions_value IS NULL OR length(definitions_value) NOT BETWEEN 1 AND 64
 OR definitions_time IS NULL OR definitions_time<now()-interval '72 hours' OR definitions_time>now()+interval '5 minutes')
 THEN verdict:='error';error_value:='definitions_stale'; END IF;
 -- Recheck live author eligibility after scanner I/O; the worker cannot choose the actor.
 PERFORM set_config('cape.user_id',s.owner_id,true);
 IF verdict<>'infected' AND (d.excluded OR s.kind<>'document' OR NOT app.document_account_allowed()) THEN
  verdict:='cancelled';error_value:='ineligible';
 END IF;
 event_name:=verdict;
 IF verdict='clean' THEN
  UPDATE app.documents SET state='available' WHERE id=doc AND state='scanning';
 ELSIF verdict='infected' THEN
  UPDATE app.documents SET state='infected' WHERE id=doc;
 ELSIF verdict='cancelled' OR j.attempts>=5 OR error_value IN ('integrity_mismatch','object_missing','size_limit') THEN
  UPDATE app.documents SET state='scan_failed' WHERE id=doc;
  IF verdict<>'cancelled' THEN verdict:='exhausted'; END IF;
 ELSE
  UPDATE app.documents SET state='quarantined' WHERE id=doc;
  verdict:='queued';
 END IF;
 UPDATE app.document_scans SET state=verdict,scanned_sha256=CASE WHEN checksum ~ '^[0-9a-f]{64}$' THEN checksum ELSE NULL END,
 engine=left(engine_value,128),definitions_version=left(definitions_value,64),definitions_at=definitions_time,
 error_category=error_value,completed_at=now(),lease_token=NULL,lease_until=NULL,
 available_at=now()+least(3600,30*power(2,attempts))*interval '1 second' WHERE document_id=doc;
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id) VALUES(doc,j.attempts,event_name,j.correlation_id);
 INSERT INTO app.audit_events(document_id,submission_id,action,outcome,correlation_id)
 VALUES(doc,d.submission_id,'document.scan.'||event_name,CASE WHEN event_name='clean' THEN 'ok'::app.audit_outcome ELSE 'error'::app.audit_outcome END,j.correlation_id);
 RETURN true;
END $$;
