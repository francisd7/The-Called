ALTER TABLE "leads" ADD COLUMN "is_active_convo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "leads_active_convo_idx" ON "leads" USING btree ("is_active_convo","setter_id");