ALTER TYPE "app"."submission_status" ADD VALUE 'draft' BEFORE 'submitted';--> statement-breakpoint
CREATE TABLE "app"."submission_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"event" text NOT NULL,
	"version" integer NOT NULL,
	"revision" integer NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"abstract" text NOT NULL,
	"keywords" text[] NOT NULL,
	"confidential" boolean NOT NULL,
	"document_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."submission_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."submissions" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."submission_events" ADD CONSTRAINT "submission_events_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "app"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."submission_events" ADD CONSTRAINT "submission_events_actor_id_clergy_profiles_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_event_parent_idx" ON "app"."submission_events" USING btree ("submission_id","created_at");