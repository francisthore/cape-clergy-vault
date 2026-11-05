ALTER TABLE "app"."approval_notifications" ADD COLUMN "sender_from" text;--> statement-breakpoint
ALTER TABLE "app"."approval_notifications" ADD COLUMN "sender_reply_to" text;--> statement-breakpoint
ALTER TABLE "app"."approval_notifications" ADD COLUMN "recipient_email" text;