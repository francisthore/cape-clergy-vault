CREATE TABLE "app"."document_scan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"event" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."document_scan_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."document_scans" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"expected_sha256" text NOT NULL,
	"scanned_sha256" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"engine" text,
	"definitions_version" text,
	"definitions_at" timestamp with time zone,
	"error_category" text,
	"correlation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_scan_state" CHECK ("app"."document_scans"."state" in ('queued','scanning','clean','infected','exhausted','cancelled')),
	CONSTRAINT "document_scan_attempts" CHECK ("app"."document_scans"."attempts" between 0 and 5),
	CONSTRAINT "document_scan_hash" CHECK ("app"."document_scans"."expected_sha256" ~ '^[0-9a-f]{64}$' and ("app"."document_scans"."scanned_sha256" is null or "app"."document_scans"."scanned_sha256" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "document_scan_lease" CHECK (("app"."document_scans"."state"='scanning' and "app"."document_scans"."lease_token" is not null and "app"."document_scans"."lease_until" is not null) or ("app"."document_scans"."state"<>'scanning' and "app"."document_scans"."lease_token" is null and "app"."document_scans"."lease_until" is null)),
	CONSTRAINT "document_scan_clean_evidence" CHECK ("app"."document_scans"."state"<>'clean' or ("app"."document_scans"."scanned_sha256" is not null and "app"."document_scans"."scanned_sha256"="app"."document_scans"."expected_sha256" and "app"."document_scans"."engine" is not null and "app"."document_scans"."definitions_version" is not null and "app"."document_scans"."definitions_at" is not null and "app"."document_scans"."completed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "app"."document_scans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."documents" DROP CONSTRAINT "document_state_valid";--> statement-breakpoint
ALTER TABLE "app"."document_scan_events" ADD CONSTRAINT "document_scan_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_scans" ADD CONSTRAINT "document_scans_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "app"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_scan_event_idx" ON "app"."document_scan_events" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "document_scan_queue_idx" ON "app"."document_scans" USING btree ("state","available_at");--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "document_state_valid" CHECK ("app"."documents"."state" in ('pending', 'quarantined', 'scanning', 'available', 'infected', 'scan_failed', 'legacy_unscanned', 'failed'));