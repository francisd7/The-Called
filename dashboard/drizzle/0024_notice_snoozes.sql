CREATE TABLE "notice_snoozes" (
	"key" text PRIMARY KEY NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"by_id" uuid
);
--> statement-breakpoint
ALTER TABLE "notice_snoozes" ADD CONSTRAINT "notice_snoozes_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;