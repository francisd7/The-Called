DROP INDEX "focus_owner_week_idx";--> statement-breakpoint
ALTER TABLE "focuses" ADD CONSTRAINT "focus_owner_week_key" UNIQUE NULLS NOT DISTINCT("owner_id","week_of");