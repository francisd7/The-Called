ALTER TABLE "eod_reports" ADD COLUMN "airtable_record_id" text;--> statement-breakpoint
ALTER TABLE "eod_reports" ADD COLUMN "legacy" jsonb;--> statement-breakpoint
ALTER TABLE "eod_reports" ADD CONSTRAINT "eod_reports_airtable_record_id_unique" UNIQUE("airtable_record_id");