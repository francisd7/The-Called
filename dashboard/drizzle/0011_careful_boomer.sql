ALTER TABLE "leads" ADD COLUMN "call_outcome" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "fathom_url" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "outcome_logged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "outcome_logged_by_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_outcome_logged_by_id_users_id_fk" FOREIGN KEY ("outcome_logged_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;