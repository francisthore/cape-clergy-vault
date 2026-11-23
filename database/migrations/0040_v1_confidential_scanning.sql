CREATE TABLE "app"."confidential_scan_approvals" (
	"reference" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "approval_reference_present" CHECK (length(btrim("app"."confidential_scan_approvals"."reference")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "app"."confidential_scan_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."document_scans" ADD COLUMN "confidential_approval" text;--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_confidential_scan_approval" ON "app"."confidential_scan_approvals" USING btree ((true)) WHERE "app"."confidential_scan_approvals"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "app"."document_scans" ADD CONSTRAINT "document_scans_confidential_approval_confidential_scan_approvals_reference_fk" FOREIGN KEY ("confidential_approval") REFERENCES "app"."confidential_scan_approvals"("reference") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- No approval is seeded. Only a guarded owner can record an actual decision.
CREATE FUNCTION app.confidential_scanning_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS (SELECT 1 FROM app.confidential_scan_approvals WHERE revoked_at IS NULL)
$$;
REVOKE ALL ON FUNCTION app.confidential_scanning_enabled() FROM PUBLIC;
REVOKE ALL ON app.confidential_scan_approvals FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.finalize_document(doc uuid,size bigint,checksum text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE parent uuid; confidential_parent boolean; approval_ref text;
BEGIN
 SELECT d.submission_id,s.confidential INTO parent,confidential_parent FROM app.documents d JOIN app.submissions s ON s.id=d.submission_id
 WHERE d.id=doc AND d.state='pending' AND NOT d.excluded AND s.owner_id=app.request_user_id()
 AND s.status::text='draft' AND s.kind='document' FOR SHARE OF s;
 IF parent IS NULL OR NOT app.document_account_allowed() THEN RAISE EXCEPTION 'Document authorization required' USING ERRCODE='42501'; END IF;
 IF size IS NULL OR size<=0 OR size>4194304 OR checksum IS NULL OR checksum !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'Invalid document metadata' USING ERRCODE='22023'; END IF;
 IF confidential_parent THEN
  SELECT reference INTO approval_ref FROM app.confidential_scan_approvals WHERE revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Confidential screening unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 UPDATE app.documents SET state='quarantined',byte_size=size,sha256=checksum WHERE id=doc AND state='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'Document conflict' USING ERRCODE='23505'; END IF;
 INSERT INTO app.document_scans(document_id,expected_sha256,confidential_approval,provider)
 VALUES(doc,checksum,approval_ref,CASE WHEN confidential_parent THEN 'bouncer' ELSE 'clamav' END);
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id)
 SELECT doc,0,'quarantined',correlation_id FROM app.document_scans WHERE document_id=doc;
 INSERT INTO app.audit_events(document_id,submission_id,action,outcome) VALUES(doc,parent,'document.scan.quarantined','ok');
END $$;
--> statement-breakpoint
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
 -- Resume known provider work without issuing another upload. New confidential
 -- transfers require the same still-active decision as the author's upload.
 AND (q.external_scan_id IS NOT NULL OR q.provider_status='submitting' OR
  (x.byte_size BETWEEN 1 AND 4194304 AND EXISTS (
   SELECT 1 FROM app.submissions s WHERE s.id=x.submission_id AND
   (NOT s.confidential OR EXISTS (SELECT 1 FROM app.confidential_scan_approvals a
    WHERE a.reference=q.confidential_approval AND a.revoked_at IS NULL)))))
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
 SELECT p.* INTO s FROM app.submissions p JOIN app.documents x ON x.submission_id=p.id WHERE x.id=doc FOR UPDATE OF p;
 SELECT * INTO d FROM app.documents WHERE id=doc FOR UPDATE;
 SELECT * INTO j FROM app.document_scans WHERE document_id=doc FOR UPDATE;
 IF j.document_id IS NULL OR j.provider<>'bouncer' OR j.state<>'scanning' OR j.lease_token IS DISTINCT FROM token OR j.lease_until<=now()
 OR j.external_scan_id IS NOT NULL OR j.provider_status<>'new' THEN RETURN false; END IF;
 PERFORM set_config('cape.user_id',s.owner_id,true);
 IF d.excluded OR d.state<>'scanning' OR s.kind<>'document' OR s.revision IS DISTINCT FROM j.submission_revision
 OR d.sha256 IS DISTINCT FROM j.expected_sha256 OR d.byte_size IS DISTINCT FROM j.expected_byte_size
 OR d.byte_size NOT BETWEEN 1 AND 4194304 OR NOT app.document_account_allowed() THEN RAISE EXCEPTION 'Scan ineligible' USING ERRCODE='42501'; END IF;
 IF s.confidential THEN
  PERFORM 1 FROM app.confidential_scan_approvals WHERE reference=j.confidential_approval AND revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Confidential screening unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 IF used IS NULL OR used<0 OR quota IS NULL OR quota<1 OR quota>500 OR period_value IS DISTINCT FROM to_char(now() AT TIME ZONE 'UTC','YYYY-MM')
 THEN RAISE EXCEPTION 'Invalid free quota evidence' USING ERRCODE='22023'; END IF;
 INSERT INTO app.scanner_budget(period) VALUES(period_value) ON CONFLICT DO NOTHING;
 SELECT reserved INTO reserved_count FROM app.scanner_budget WHERE period=period_value FOR UPDATE;
 IF greatest(reserved_count,used)>=quota OR EXISTS(SELECT 1 FROM app.scanner_budget WHERE period=period_value AND blocked_until>now()) THEN
  UPDATE app.scanner_budget SET observed_used=used,blocked_until=(date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC',updated_at=now() WHERE period=period_value;
  RETURN false;
 END IF;
 -- Write fence serializes confidentiality changes, including repeatable-read transactions.
 -- No status/metadata changes or workflow events are made by this identity-only update.
 UPDATE app.submissions SET id=id WHERE id=s.id;
 UPDATE app.scanner_budget SET reserved=greatest(reserved_count,used)+1,observed_used=used,updated_at=now() WHERE period=period_value;
 UPDATE app.document_scans SET provider_status='submitting',submitted_at=now() WHERE document_id=doc;
 INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id) VALUES(doc,j.attempts,'bouncer.submitting',j.correlation_id);
 IF s.confidential THEN
  INSERT INTO app.document_scan_events(document_id,attempt,event,correlation_id)
  VALUES(doc,j.attempts,'bouncer.confidential_reserved_v1',j.correlation_id);
 END IF;
 RETURN true;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_external_scan_classification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.confidential IS DISTINCT FROM OLD.confidential AND EXISTS(
  SELECT 1 FROM app.documents d JOIN app.document_scans j ON j.document_id=d.id
  WHERE d.submission_id=OLD.id AND j.provider='bouncer'
  AND (j.submitted_at IS NOT NULL OR j.external_scan_id IS NOT NULL OR j.provider_status IN ('submitting','ambiguous')))
 THEN RAISE EXCEPTION 'External screening already initiated; create a separate draft' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.document_is_clean(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.documents d JOIN app.document_scans j ON j.document_id=d.id
 JOIN app.submissions s ON s.id=d.submission_id
 WHERE d.id=doc AND d.state='available' AND j.state='clean' AND j.expected_sha256=d.sha256
 AND j.scanned_sha256=d.sha256 AND j.completed_at IS NOT NULL
 AND (NOT s.confidential OR j.provider<>'bouncer' OR (
  j.confidential_approval IS NOT NULL AND j.expected_byte_size=d.byte_size
  AND EXISTS (SELECT 1 FROM app.document_scan_events e WHERE e.document_id=d.id
   AND e.correlation_id=j.correlation_id AND e.event='bouncer.confidential_reserved_v1'))))
$$;
--> statement-breakpoint
-- Role creation may follow migration on a new database. The reviewed grants file
-- also assigns this read-only metadata function after provisioning.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cape_clergy_runtime') THEN
  GRANT EXECUTE ON FUNCTION app.confidential_scanning_enabled() TO cape_clergy_runtime;
 END IF;
END $$;
--> statement-breakpoint
-- Preserve historical oversized objects and evidence. Enforce the V1 bound
-- on new metadata and size changes, allowing other lifecycle updates to old rows.
CREATE FUNCTION app.guard_v1_document_size() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.byte_size > 4194304 AND (TG_OP='INSERT' OR NEW.byte_size IS DISTINCT FROM OLD.byte_size) THEN
  RAISE EXCEPTION 'Maximum 4 MiB per PDF' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER v1_document_size BEFORE INSERT OR UPDATE OF byte_size ON app.documents
 FOR EACH ROW EXECUTE FUNCTION app.guard_v1_document_size();
REVOKE ALL ON FUNCTION app.guard_v1_document_size() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION app.guard_confidential_approval() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
  AND NEW.reference=OLD.reference AND NEW.created_at=OLD.created_at THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Retain processing decision evidence' USING ERRCODE='55000';
END $$;
CREATE TRIGGER confidential_approval_evidence BEFORE UPDATE OR DELETE ON app.confidential_scan_approvals
 FOR EACH ROW EXECUTE FUNCTION app.guard_confidential_approval();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON app.confidential_scan_approvals
 FOR EACH STATEMENT EXECUTE FUNCTION app.reject_history_mutation();
REVOKE ALL ON FUNCTION app.guard_confidential_approval() FROM PUBLIC;
