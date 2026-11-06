CREATE TABLE "app"."rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"hits" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."approval_notifications" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "rate_limits_expiry_idx" ON "app"."rate_limits" USING btree ("expires_at");--> statement-breakpoint
-- No logins/grants are created by migrations. Local setup and proposed production
-- provisioning separately give EXECUTE only to the named notification identity.
CREATE FUNCTION app.require_notification_worker() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF session_user NOT IN ('cape_clergy_notifications','cape_clergy_dev') THEN
  RAISE EXCEPTION 'Notification worker required' USING ERRCODE='42501';
 END IF;
END $$;

-- Internal eligibility helper; never worker-executable. Restore the actor even
-- on exceptions; the target comes only from the locked durable intent.
CREATE FUNCTION app.notification_eligible(queue text, notification uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n app.reviewer_notifications; previous_actor text; allowed boolean;
BEGIN
 IF queue='approval' THEN
  RETURN EXISTS(SELECT 1 FROM app.approval_notifications a JOIN auth.users u ON u.id=a.user_id
   WHERE a.id=notification AND a.cancelled_at IS NULL AND a.delivered_at IS NULL
   AND (a.recipient_email IS NULL OR a.recipient_email=u.email));
 ELSIF queue<>'reviewer' THEN RETURN false; END IF;
 SELECT * INTO n FROM app.reviewer_notifications WHERE id=notification;
 IF NOT FOUND OR n.cancelled_at IS NOT NULL OR n.delivered_at IS NOT NULL THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=n.user_id AND u.email_verified
   AND (n.recipient_email IS NULL OR n.recipient_email=u.email)) THEN RETURN false; END IF;
 IF n.kind='reviewer_invitation' THEN
  RETURN EXISTS(SELECT 1 FROM app.reviewer_invitations i JOIN auth.users u ON u.id=i.user_id
   WHERE i.id=n.invitation_id AND i.user_id=n.user_id AND i.state='pending' AND i.expires_at>now()
   AND i.mailbox=u.email AND n.sealed_token IS NOT NULL);
 ELSIF n.kind='review_assigned' THEN
  previous_actor:=current_setting('cape.user_id',true);
  PERFORM set_config('cape.user_id',n.user_id,true);
  allowed:=app.assignment_notification_allowed(n.id);
  PERFORM set_config('cape.user_id',coalesce(previous_actor,''),true);
  RETURN allowed;
 END IF;
 RETURN n.kind IN ('submission_accepted','submission_returned');
END $$;

CREATE FUNCTION app.claim_notification(queue text, lease uuid, only_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app.require_notification_worker();
 IF lease IS NULL THEN RAISE EXCEPTION 'Lease required' USING ERRCODE='22023'; END IF;
 IF queue='approval' THEN
  UPDATE app.approval_notifications n SET attempts=n.attempts+1,lease_token=lease,available_at=now()+interval '5 minutes'
  WHERE n.id=(SELECT id FROM app.approval_notifications WHERE delivered_at IS NULL AND cancelled_at IS NULL
   AND attempts<8 AND available_at<=now() AND (only_id IS NULL OR id=only_id)
   ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING jsonb_build_object('id',id,'kind',kind) INTO result;
 ELSIF queue='reviewer' THEN
  UPDATE app.reviewer_notifications n SET attempts=n.attempts+1,lease_token=lease,available_at=now()+interval '5 minutes'
  WHERE n.id=(SELECT id FROM app.reviewer_notifications WHERE delivered_at IS NULL AND cancelled_at IS NULL
   AND attempts<8 AND available_at<=now() AND (only_id IS NULL OR id=only_id)
   ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING jsonb_build_object('id',id,'kind',kind) INTO result;
 ELSE RAISE EXCEPTION 'Unknown queue' USING ERRCODE='22023'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION app.check_notification(queue text, notification uuid, lease uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live boolean; allowed boolean;
BEGIN
 PERFORM app.require_notification_worker();
 IF queue='approval' THEN
  SELECT true INTO live FROM app.approval_notifications WHERE id=notification AND lease_token=lease
   AND available_at>now() AND delivered_at IS NULL AND cancelled_at IS NULL FOR UPDATE;
 ELSIF queue='reviewer' THEN
  SELECT true INTO live FROM app.reviewer_notifications WHERE id=notification AND lease_token=lease
   AND available_at>now() AND delivered_at IS NULL AND cancelled_at IS NULL FOR UPDATE;
 ELSE RAISE EXCEPTION 'Unknown queue' USING ERRCODE='22023'; END IF;
 IF live IS DISTINCT FROM true THEN RETURN false; END IF;
 allowed:=app.notification_eligible(queue,notification);
 IF NOT allowed THEN
  IF queue='approval' THEN
   UPDATE app.approval_notifications SET cancelled_at=now(),lease_token=NULL,last_error='recipient_ineligible' WHERE id=notification;
   INSERT INTO app.audit_events(target_user_id,action,outcome,correlation_id)
    SELECT user_id,'approval.notification_cancelled','ok',id FROM app.approval_notifications WHERE id=notification;
  ELSE
   UPDATE app.reviewer_notifications SET cancelled_at=now(),sealed_token=NULL,lease_token=NULL,last_error='recipient_ineligible' WHERE id=notification;
  END IF;
 END IF;
 RETURN allowed;
END $$;

CREATE FUNCTION app.prepare_notification(queue text, notification uuid, lease uuid, sender text, reply text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app.require_notification_worker();
 IF NOT app.check_notification(queue,notification,lease) THEN RETURN NULL; END IF;
 IF sender IS NULL OR length(sender)>320 OR sender ~ '[\r\n]' OR reply IS NULL OR length(reply)>254 OR reply ~ '[\r\n]' THEN
  RAISE EXCEPTION 'Invalid sender' USING ERRCODE='22023'; END IF;
 IF queue='approval' THEN
  UPDATE app.approval_notifications n SET sender_from=coalesce(sender_from,sender),sender_reply_to=coalesce(sender_reply_to,reply),
   recipient_email=coalesce(recipient_email,(SELECT email FROM auth.users WHERE id=n.user_id))
   WHERE id=notification RETURNING jsonb_build_object('from',sender_from,'replyTo',sender_reply_to,'to',recipient_email) INTO result;
 ELSE
  UPDATE app.reviewer_notifications n SET sender_from=coalesce(sender_from,sender),sender_reply_to=coalesce(sender_reply_to,reply),
   recipient_email=coalesce(recipient_email,(SELECT email FROM auth.users WHERE id=n.user_id))
   WHERE id=notification RETURNING jsonb_build_object('from',sender_from,'replyTo',sender_reply_to,'to',recipient_email,
    'submissionId',submission_id,'identity',CASE WHEN kind='reviewer_invitation' THEN user_id END,
    'sealedToken',sealed_token,'digest',(SELECT token_digest FROM app.reviewer_invitations WHERE id=n.invitation_id)) INTO result;
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION app.finish_notification(queue text, notification uuid, lease uuid, success boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE changed integer;
BEGIN
 PERFORM app.require_notification_worker();
 IF success IS NULL THEN RAISE EXCEPTION 'Outcome required' USING ERRCODE='22023'; END IF;
 IF queue='approval' THEN
  UPDATE app.approval_notifications SET delivered_at=CASE WHEN success THEN now() ELSE NULL END,lease_token=NULL,
   last_error=CASE WHEN success THEN NULL ELSE 'delivery_failed' END,
   available_at=CASE WHEN success THEN available_at ELSE now()+least(3600,30*power(2,attempts))*interval '1 second' END
   WHERE id=notification AND lease_token=lease AND available_at>now() AND delivered_at IS NULL AND cancelled_at IS NULL;
 ELSIF queue='reviewer' THEN
  UPDATE app.reviewer_notifications SET delivered_at=CASE WHEN success THEN now() ELSE NULL END,lease_token=NULL,
   sealed_token=CASE WHEN success THEN NULL ELSE sealed_token END,
   last_error=CASE WHEN success THEN NULL ELSE 'delivery_failed' END,
   available_at=CASE WHEN success THEN available_at ELSE now()+least(3600,30*power(2,attempts))*interval '1 second' END
   WHERE id=notification AND lease_token=lease AND available_at>now() AND delivered_at IS NULL AND cancelled_at IS NULL;
 ELSE RAISE EXCEPTION 'Unknown queue' USING ERRCODE='22023'; END IF;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed=1;
END $$;
REVOKE ALL ON FUNCTION app.require_notification_worker(),app.notification_eligible(text,uuid),
 app.claim_notification(text,uuid,uuid),app.check_notification(text,uuid,uuid),
 app.prepare_notification(text,uuid,uuid,text,text),app.finish_notification(text,uuid,uuid,boolean) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION app.consume_rate_limit(purpose text, digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE maximum integer; seconds integer:=60; result app.rate_limits; bucket text;
BEGIN
 IF digest IS NULL OR digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid digest' USING ERRCODE='22023'; END IF;
 maximum:=CASE purpose WHEN 'auth' THEN 120 WHEN 'login' THEN 20 WHEN 'register' THEN 10
  WHEN 'mail' THEN 1 WHEN 'reset' THEN 10 WHEN 'invitation' THEN 10 WHEN 'admin' THEN 60
  WHEN 'test_email' THEN 1 WHEN 'upload' THEN 20 WHEN 'search' THEN 120 END;
 IF maximum IS NULL THEN RAISE EXCEPTION 'Unknown limit' USING ERRCODE='22023'; END IF;
 IF purpose='upload' THEN seconds:=600; END IF;
 bucket:=purpose||':'||digest;
 -- Bounded cardinality and cleanup; fixed namespace lock serializes short DB work only.
 PERFORM pg_advisory_xact_lock(440040);
 DELETE FROM app.rate_limits WHERE key IN
  (SELECT key FROM app.rate_limits WHERE expires_at<=now() ORDER BY expires_at LIMIT 500);
 IF NOT EXISTS(SELECT 1 FROM app.rate_limits WHERE key=bucket) AND
  (SELECT count(*) FROM (SELECT 1 FROM app.rate_limits LIMIT 50000) capped)>=50000 THEN
  RETURN jsonb_build_object('allowed',false,'retryAfter',60);
 END IF;
 INSERT INTO app.rate_limits(key,hits,expires_at) VALUES(bucket,1,now()+seconds*interval '1 second')
 ON CONFLICT(key) DO UPDATE SET hits=least(app.rate_limits.hits+1,maximum+1)
 RETURNING * INTO result;
 RETURN jsonb_build_object('allowed',result.hits<=maximum,'retryAfter',greatest(1,ceil(extract(epoch FROM result.expires_at-now()))::integer));
END $$;
REVOKE ALL ON FUNCTION app.consume_rate_limit(text,text) FROM PUBLIC;
