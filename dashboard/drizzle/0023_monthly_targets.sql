CREATE TABLE "monthly_targets" (
	"metric" text PRIMARY KEY NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"set_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monthly_targets" ADD CONSTRAINT "monthly_targets_set_by_id_users_id_fk" FOREIGN KEY ("set_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;