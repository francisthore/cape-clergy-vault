ALTER TYPE "app"."app_role" ADD VALUE 'approver';--> statement-breakpoint
CREATE TABLE "app"."approval_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "approval_notifications_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
ALTER TABLE "app"."approval_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."approver_bootstrap" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."approver_bootstrap" ENABLE ROW LEVEL SECURITY;