CREATE TABLE "app"."reviewer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid,
	"assignment_id" uuid,
	"reviewer_id" text NOT NULL,
	"actor_id" text,
	"operator" text,
	"action" text NOT NULL,
	"correlation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."reviewer_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."reviewer_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"mailbox" text NOT NULL,
	"token_digest" text NOT NULL,
	"issued_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "reviewer_invitations_token_digest_unique" UNIQUE("token_digest"),
	CONSTRAINT "reviewer_invitation_digest" CHECK ("app"."reviewer_invitations"."token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "reviewer_invitation_expiry" CHECK ("app"."reviewer_invitations"."expires_at">"app"."reviewer_invitations"."created_at" and "app"."reviewer_invitations"."expires_at"<="app"."reviewer_invitations"."created_at"+interval '1 hour'),
	CONSTRAINT "reviewer_invitation_state" CHECK (("app"."reviewer_invitations"."state"='pending' and "app"."reviewer_invitations"."accepted_at" is null and "app"."reviewer_invitations"."revoked_at" is null) or ("app"."reviewer_invitations"."state"='accepted' and "app"."reviewer_invitations"."accepted_at" is not null and "app"."reviewer_invitations"."revoked_at" is null) or ("app"."reviewer_invitations"."state"='revoked' and "app"."reviewer_invitations"."revoked_at" is not null and "app"."reviewer_invitations"."accepted_at" is null))
);
--> statement-breakpoint
ALTER TABLE "app"."reviewer_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."reviewer_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"invitation_id" uuid,
	"submission_id" uuid,
	"assignment_id" uuid,
	"sealed_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"last_error" text,
	"sender_from" text,
	"sender_reply_to" text,
	"recipient_email" text,
	CONSTRAINT "reviewer_notifications_event_key_unique" UNIQUE("event_key"),
	CONSTRAINT "reviewer_notification_kind" CHECK ("app"."reviewer_notifications"."kind" in ('reviewer_invitation','review_assigned','submission_accepted','submission_returned')),
	CONSTRAINT "reviewer_notification_proof" CHECK (("app"."reviewer_notifications"."kind"='reviewer_invitation' and "app"."reviewer_notifications"."invitation_id" is not null) or ("app"."reviewer_notifications"."kind"<>'reviewer_invitation' and "app"."reviewer_notifications"."submission_id" is not null and "app"."reviewer_notifications"."sealed_token" is null))
);
--> statement-breakpoint
ALTER TABLE "app"."reviewer_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."reviewer_events" ADD CONSTRAINT "reviewer_events_invitation_id_reviewer_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "app"."reviewer_invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reviewer_events" ADD CONSTRAINT "reviewer_events_assignment_id_reviewer_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "app"."reviewer_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reviewer_events" ADD CONSTRAINT "reviewer_events_reviewer_id_clergy_profiles_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reviewer_events" ADD CONSTRAINT "reviewer_events_actor_id_clergy_profiles_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reviewer_invitations" ADD CONSTRAINT "reviewer_invitations_user_id_clergy_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reviewer_notifications" ADD CONSTRAINT "reviewer_notifications_user_id_clergy_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."clergy_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reviewer_notifications" ADD CONSTRAINT "reviewer_notifications_invitation_id_reviewer_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "app"."reviewer_invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reviewer_notifications" ADD CONSTRAINT "reviewer_notifications_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "app"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reviewer_notifications" ADD CONSTRAINT "reviewer_notifications_assignment_id_reviewer_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "app"."reviewer_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviewer_event_identity_idx" ON "app"."reviewer_events" USING btree ("reviewer_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviewer_invitation_pending_unique" ON "app"."reviewer_invitations" USING btree ("user_id") WHERE "app"."reviewer_invitations"."state"='pending';--> statement-breakpoint
CREATE INDEX "reviewer_notifications_pending_idx" ON "app"."reviewer_notifications" USING btree ("available_at","created_at");