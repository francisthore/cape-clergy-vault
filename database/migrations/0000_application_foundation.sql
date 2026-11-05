CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."app_role" AS ENUM('clergy', 'admin');--> statement-breakpoint
CREATE TYPE "app"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TYPE "app"."consent_action" AS ENUM('accepted', 'withdrawn');--> statement-breakpoint
CREATE TYPE "app"."consent_purpose" AS ENUM('repository', 'private_chat');--> statement-breakpoint
CREATE TYPE "app"."review_outcome" AS ENUM('under_review', 'accepted', 'returned');--> statement-breakpoint
CREATE TYPE "app"."submission_kind" AS ENUM('document', 'idea');--> statement-breakpoint
CREATE TYPE "app"."submission_status" AS ENUM('submitted', 'under_review', 'accepted', 'returned');--> statement-breakpoint
CREATE TYPE "app"."audit_outcome" AS ENUM('ok', 'denied', 'error');--> statement-breakpoint
CREATE TABLE "app"."account_approval_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"status" "app"."approval_status" NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."account_approval_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."clergy_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"parish" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"approval_status" "app"."approval_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_user_id_nonempty" CHECK (length(btrim("app"."clergy_profiles"."user_id")) > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."clergy_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" "app"."app_role" NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "role_revoked_after_grant" CHECK ("app"."role_assignments"."revoked_at" is null or "app"."role_assignments"."revoked_at" >= "app"."role_assignments"."created_at")
);
--> statement-breakpoint
ALTER TABLE "app"."role_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."popia_consent_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."popia_consent_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"notice_version" text NOT NULL,
	"purpose" "app"."consent_purpose" NOT NULL,
	"action" "app"."consent_action" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_version_nonempty" CHECK (length(btrim("app"."popia_consent_events"."notice_version")) > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."popia_consent_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "document_size_nonnegative" CHECK ("app"."documents"."byte_size" >= 0),
	CONSTRAINT "document_sha256_format" CHECK ("app"."documents"."sha256" is null or "app"."documents"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "app"."documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."review_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"outcome" "app"."review_outcome" NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."review_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"kind" "app"."submission_kind" DEFAULT 'document' NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"abstract" text DEFAULT '' NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"status" "app"."submission_status" DEFAULT 'submitted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_title_nonempty" CHECK (length(btrim("app"."submissions"."title")) > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."chat_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_body_length" CHECK (char_length(btrim("app"."chat_messages"."body")) between 1 and 4000)
);
--> statement-breakpoint
ALTER TABLE "app"."chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."chat_notification_preferences" (
	"user_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "chat_notification_preferences_user_id_owner_id_pk" PRIMARY KEY("user_id","owner_id")
);
--> statement-breakpoint
ALTER TABLE "app"."chat_notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."audit_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."audit_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"target_user_id" text,
	"submission_id" uuid,
	"action" text NOT NULL,
	"outcome" "app"."audit_outcome" NOT NULL,
	"correlation_id" uuid
);
--> statement-breakpoint
ALTER TABLE "app"."audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."account_approval_events" ADD CONSTRAINT "account_approval_events_user_id_clergy_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."account_approval_events" ADD CONSTRAINT "account_approval_events_actor_id_clergy_profiles_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."role_assignments" ADD CONSTRAINT "role_assignments_user_id_clergy_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."role_assignments" ADD CONSTRAINT "role_assignments_granted_by_clergy_profiles_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."popia_consent_events" ADD CONSTRAINT "popia_consent_events_user_id_clergy_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "app"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."review_decisions" ADD CONSTRAINT "review_decisions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "app"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."review_decisions" ADD CONSTRAINT "review_decisions_reviewer_id_clergy_profiles_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD CONSTRAINT "submissions_owner_id_clergy_profiles_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chat_messages" ADD CONSTRAINT "chat_messages_owner_id_clergy_profiles_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chat_messages" ADD CONSTRAINT "chat_messages_sender_id_clergy_profiles_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chat_notification_preferences" ADD CONSTRAINT "chat_notification_preferences_user_id_clergy_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."chat_notification_preferences" ADD CONSTRAINT "chat_notification_preferences_owner_id_clergy_profiles_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_user_created_idx" ON "app"."account_approval_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "role_active_unique" ON "app"."role_assignments" USING btree ("user_id","role") WHERE "app"."role_assignments"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "consent_user_purpose_created_idx" ON "app"."popia_consent_events" USING btree ("user_id","purpose","created_at","id");--> statement-breakpoint
CREATE INDEX "document_submission_idx" ON "app"."documents" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "review_submission_created_idx" ON "app"."review_decisions" USING btree ("submission_id","created_at");--> statement-breakpoint
CREATE INDEX "submission_owner_created_idx" ON "app"."submissions" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "submission_status_idx" ON "app"."submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chat_owner_created_idx" ON "app"."chat_messages" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "app"."audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_actor_created_idx" ON "app"."audit_events" USING btree ("actor_id","created_at");