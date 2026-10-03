-- Written to be safe to re-run. A failed migration is a failed boot, so a
-- half-applied state must not be able to stop the app from starting.
ALTER TABLE "boosted_reels" ADD COLUMN IF NOT EXISTS "ad_name" text;--> statement-breakpoint
ALTER TABLE "boosted_reels" ADD COLUMN IF NOT EXISTS "impressions" integer;
