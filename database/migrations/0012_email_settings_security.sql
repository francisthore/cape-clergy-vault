INSERT INTO app.email_settings(id) VALUES(1);
INSERT INTO app.email_domains(domain) VALUES('notifications.ctdiocese.org.za');
--> statement-breakpoint
CREATE FUNCTION app.is_settings_manager() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $$
 SELECT app.is_active() AND EXISTS(SELECT 1 FROM auth.users WHERE id=app.request_user_id() AND email_verified)
 AND EXISTS(SELECT 1 FROM app.settings_managers WHERE user_id=app.request_user_id() AND revoked_at IS NULL)
$$;
CREATE FUNCTION app.require_settings_manager() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$ BEGIN
 IF NOT app.is_settings_manager() THEN RAISE EXCEPTION 'Settings permission required' USING ERRCODE='42501'; END IF;
END $$;
CREATE POLICY settings_read ON app.email_settings FOR SELECT USING(app.is_settings_manager());
CREATE POLICY settings_history_read ON app.email_settings_history FOR SELECT USING(app.is_settings_manager());
CREATE POLICY settings_domains_read ON app.email_domains FOR SELECT USING(app.is_settings_manager());
CREATE TRIGGER reject_row_mutation BEFORE UPDATE OR DELETE ON app.email_settings_history FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON app.email_settings_history FOR EACH STATEMENT EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER reject_row_mutation BEFORE UPDATE OR DELETE ON app.email_test_attempts FOR EACH ROW EXECUTE FUNCTION app.reject_history_mutation();
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON app.email_test_attempts FOR EACH STATEMENT EXECUTE FUNCTION app.reject_history_mutation();
--> statement-breakpoint
-- Resolver is server-internal, used before login for verification/reset messages.
CREATE FUNCTION app.resolve_email_settings() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog AS $$
 SELECT to_jsonb(s) || jsonb_build_object('domain_authorized',exists(
 SELECT 1 FROM app.email_domains d WHERE d.domain=s.sending_domain AND d.authorized_at IS NOT NULL))
 FROM app.email_settings s WHERE id=1
$$;
CREATE FUNCTION app.save_email_settings(expected integer, domain text, display text, sender text, reply text, transactional boolean, notifications boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE next_version integer;
BEGIN
 PERFORM app.require_settings_manager();
 IF expected IS NULL OR domain IS NULL OR display IS NULL OR sender IS NULL OR reply IS NULL OR transactional IS NULL OR notifications IS NULL
 OR domain !~ '^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'
 OR length(display) NOT BETWEEN 1 AND 100 OR display ~ '[<>\r\n]'
 OR length(sender)>254 OR sender !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+$'
 OR split_part(sender,'@',2)<>domain
 OR (reply<>'' AND (length(reply)>254 OR reply !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+$'))
 OR NOT EXISTS(SELECT 1 FROM app.email_domains WHERE email_domains.domain=$2 AND authorized_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Invalid or unauthorized sender configuration' USING ERRCODE='22023'; END IF;
 UPDATE app.email_settings SET sending_domain=domain, display_name=display,from_email=sender,reply_to=reply,
 transactional_enabled=transactional,notifications_enabled=notifications,version=version+1,updated_at=now(),updated_by=app.request_user_id()
 WHERE id=1 AND version=expected RETURNING version INTO next_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'Settings conflict' USING ERRCODE='40001'; END IF;
 INSERT INTO app.email_settings_history(version,actor_id,sending_domain,display_name,from_email,reply_to,transactional_enabled,notifications_enabled)
 VALUES(next_version,app.request_user_id(),domain,display,sender,reply,transactional,notifications);
 INSERT INTO app.audit_events(actor_id,action,outcome) VALUES(app.request_user_id(),'settings.email.updated','ok');
 RETURN next_version;
END $$;
CREATE FUNCTION app.reserve_email_test() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result uuid;
BEGIN
 PERFORM app.require_settings_manager();
 PERFORM 1 FROM app.settings_managers WHERE user_id=app.request_user_id() FOR UPDATE;
 IF EXISTS(SELECT 1 FROM app.email_test_attempts WHERE actor_id=app.request_user_id() AND created_at>now()-interval '1 minute')
 THEN RAISE EXCEPTION 'Test rate limit' USING ERRCODE='P0003'; END IF;
 INSERT INTO app.email_test_attempts(actor_id) VALUES(app.request_user_id()) RETURNING id INTO result;
 INSERT INTO app.audit_events(actor_id,action,outcome,correlation_id) VALUES(app.request_user_id(),'settings.email.test_requested','ok',result);
 RETURN result;
END $$;
--> statement-breakpoint
-- Owner-only, explicit operator commands. Never granted to the web runtime.
CREATE FUNCTION app.authorize_settings_manager(identity text, confirmation text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF confirmation IS DISTINCT FROM 'GRANT SETTINGS MANAGER '||identity OR NOT EXISTS(
 SELECT 1 FROM auth.users u JOIN app.clergy_profiles p ON p.user_id=u.id
 WHERE u.id=identity AND u.email_verified AND p.approval_status='approved') THEN
 RAISE EXCEPTION 'Exact verified approved identity and confirmation required' USING ERRCODE='42501'; END IF;
 INSERT INTO app.settings_managers(user_id) VALUES(identity) ON CONFLICT(user_id) DO UPDATE SET revoked_at=NULL,granted_at=now();
 INSERT INTO app.audit_events(target_user_id,action,outcome) VALUES(identity,'settings.manager.operator_grant','ok');
END $$;
REVOKE ALL ON FUNCTION app.is_settings_manager(),app.require_settings_manager(),app.resolve_email_settings(),
 app.save_email_settings(integer,text,text,text,text,boolean,boolean),app.reserve_email_test(),app.authorize_settings_manager(text,text) FROM PUBLIC;
