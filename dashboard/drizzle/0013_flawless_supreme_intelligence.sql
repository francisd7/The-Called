CREATE TYPE "public"."post_call_report_status" AS ENUM('pending', 'linked', 'ignored');--> statement-breakpoint
CREATE TABLE "post_call_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airtable_record_id" text NOT NULL,
	"lead_name" text NOT NULL,
	"call_date" timestamp with time zone,
	"closer_name" text,
	"setter_name" text,
	"outcome" text,
	"tier" text,
	"payment_method" text,
	"cash_collected" numeric(12, 2),
	"contract_value" numeric(12, 2),
	"notes" text,
	"fathom_url" text,
	"status" "post_call_report_status" DEFAULT 'pending' NOT NULL,
	"lead_id" uuid,
	"lead_was_created" boolean DEFAULT false NOT NULL,
	"linked_by_id" uuid,
	"linked_at" timestamp with time zone,
	"fingerprint" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_call_reports_airtable_record_id_unique" UNIQUE("airtable_record_id")
);
--> statement-breakpoint
ALTER TABLE "post_call_reports" ADD CONSTRAINT "post_call_reports_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_call_reports" ADD CONSTRAINT "post_call_reports_linked_by_id_users_id_fk" FOREIGN KEY ("linked_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_call_reports_status_idx" ON "post_call_reports" USING btree ("status","call_date");