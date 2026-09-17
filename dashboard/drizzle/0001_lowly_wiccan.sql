ALTER TABLE "leads" ADD COLUMN "qualified" boolean;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "closed" boolean;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "closed_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "cash_collected" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "contract_value" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lost_reason" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "post_call_notes" text;