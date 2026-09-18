ALTER TABLE "leads" ADD COLUMN "post_call_record_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "needs_handle" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_post_call_record_id_unique" UNIQUE("post_call_record_id");