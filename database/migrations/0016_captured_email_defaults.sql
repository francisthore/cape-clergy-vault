ALTER TABLE "app"."email_settings" ALTER COLUMN "transactional_enabled" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "app"."email_settings" ALTER COLUMN "notifications_enabled" SET DEFAULT true;
--> statement-breakpoint
-- Only untouched bootstrap defaults: preserve every manager's saved preference.
-- Live Resend remains blocked by separate operator domain authorization and environment gates.
UPDATE app.email_settings SET transactional_enabled=true,notifications_enabled=true
WHERE id=1 AND version=1 AND updated_by IS NULL;
