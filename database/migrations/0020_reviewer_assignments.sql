CREATE TABLE "app"."reviewer_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"reviewer_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"correlation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	CONSTRAINT "reviewer_assignment_revision_positive" CHECK ("app"."reviewer_assignments"."revision">0),
	CONSTRAINT "reviewer_assignment_state" CHECK (("app"."reviewer_assignments"."status"='active' and "app"."reviewer_assignments"."revoked_at" is null) or ("app"."reviewer_assignments"."status"='revoked' and "app"."reviewer_assignments"."revoked_at">="app"."reviewer_assignments"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "app"."reviewer_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."review_decisions" ADD COLUMN "author_feedback" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."review_decisions" ADD COLUMN "revision" integer;--> statement-breakpoint
ALTER TABLE "app"."review_decisions" ADD COLUMN "expected_version" integer;--> statement-breakpoint
ALTER TABLE "app"."review_decisions" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."review_decisions" ADD COLUMN "assignment_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."reviewer_assignments" ADD CONSTRAINT "reviewer_assignments_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "app"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reviewer_assignments" ADD CONSTRAINT "reviewer_assignments_reviewer_id_clergy_profiles_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviewer_assignment_active_unique" ON "app"."reviewer_assignments" USING btree ("submission_id","revision","reviewer_id") WHERE "app"."reviewer_assignments"."status"='active';--> statement-breakpoint
CREATE INDEX "reviewer_assignment_inbox_idx" ON "app"."reviewer_assignments" USING btree ("reviewer_id","submission_id","revision");--> statement-breakpoint
ALTER TABLE "app"."review_decisions" ADD CONSTRAINT "review_decisions_assignment_id_reviewer_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "app"."reviewer_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."review_decisions" ADD CONSTRAINT "review_decisions_request_id_unique" UNIQUE("request_id");