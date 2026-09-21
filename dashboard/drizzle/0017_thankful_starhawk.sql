CREATE TABLE "lead_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merged_lead_id" uuid NOT NULL,
	"merged_airtable_record_id" text,
	"merged_ig_handle" text,
	"kept_lead_id" uuid NOT NULL,
	"merged_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_merges_merged_airtable_record_id_unique" UNIQUE("merged_airtable_record_id")
);
--> statement-breakpoint
CREATE TABLE "lead_not_duplicates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_a_id" uuid NOT NULL,
	"lead_b_id" uuid NOT NULL,
	"dismissed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_not_duplicates_pair" UNIQUE("lead_a_id","lead_b_id")
);
--> statement-breakpoint
ALTER TABLE "lead_merges" ADD CONSTRAINT "lead_merges_merged_by_id_users_id_fk" FOREIGN KEY ("merged_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_not_duplicates" ADD CONSTRAINT "lead_not_duplicates_lead_a_id_leads_id_fk" FOREIGN KEY ("lead_a_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_not_duplicates" ADD CONSTRAINT "lead_not_duplicates_lead_b_id_leads_id_fk" FOREIGN KEY ("lead_b_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_not_duplicates" ADD CONSTRAINT "lead_not_duplicates_dismissed_by_id_users_id_fk" FOREIGN KEY ("dismissed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_merges_kept_idx" ON "lead_merges" USING btree ("kept_lead_id");