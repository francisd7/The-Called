ALTER TABLE "leads" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "archived_by_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_archived_by_id_users_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Every list and count filters on this, so it earns an index.
CREATE INDEX IF NOT EXISTS "leads_archived_at_idx" ON "leads" ("archived_at");
