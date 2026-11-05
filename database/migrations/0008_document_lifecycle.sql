ALTER TABLE "app"."documents" ADD COLUMN "state" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD COLUMN "upload_request_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."audit_events" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "document_upload_request_unique" UNIQUE("submission_id","upload_request_id");--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "document_state_valid" CHECK ("app"."documents"."state" in ('pending', 'available', 'failed'));--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "document_available_complete" CHECK ("app"."documents"."state" <> 'available' or ("app"."documents"."byte_size" > 0 and "app"."documents"."sha256" is not null));