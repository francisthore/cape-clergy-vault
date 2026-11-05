CREATE TABLE "app"."email_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"authorized_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."email_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."email_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"sending_domain" text DEFAULT 'notifications.ctdiocese.org.za' NOT NULL,
	"display_name" text DEFAULT 'Cape Clergy Vault' NOT NULL,
	"from_email" text DEFAULT 'notifications@notifications.ctdiocese.org.za' NOT NULL,
	"reply_to" text DEFAULT '' NOT NULL,
	"transactional_enabled" boolean DEFAULT false NOT NULL,
	"notifications_enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "email_settings_singleton" CHECK ("app"."email_settings"."id"=1),
	CONSTRAINT "email_version_positive" CHECK ("app"."email_settings"."version">0)
);
--> statement-breakpoint
ALTER TABLE "app"."email_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."email_settings_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"actor_id" text NOT NULL,
	"sending_domain" text NOT NULL,
	"display_name" text NOT NULL,
	"from_email" text NOT NULL,
	"reply_to" text NOT NULL,
	"transactional_enabled" boolean NOT NULL,
	"notifications_enabled" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."email_settings_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."email_test_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."email_test_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."settings_managers" (
	"user_id" text PRIMARY KEY NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."settings_managers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."email_settings" ADD CONSTRAINT "email_settings_updated_by_clergy_profiles_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."email_settings_history" ADD CONSTRAINT "email_settings_history_actor_id_clergy_profiles_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."email_test_attempts" ADD CONSTRAINT "email_test_attempts_actor_id_clergy_profiles_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."settings_managers" ADD CONSTRAINT "settings_managers_user_id_clergy_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;