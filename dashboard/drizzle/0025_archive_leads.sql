-- Written to be safe to re-run. A failed migration is a failed boot, so a
-- half-applied state must not be able to stop the app from starting.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "archived_by_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_archived_by_id_users_id_fk"
    FOREIGN KEY ("archived_by_id") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
-- Every list and count filters on this, so it earns an index.
CREATE INDEX IF NOT EXISTS "leads_archived_at_idx" ON "leads" ("archived_at");
