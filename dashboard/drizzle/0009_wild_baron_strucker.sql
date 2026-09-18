CREATE TYPE "public"."issue_kind" AS ENUM('report', 'error');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TABLE "app_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "issue_kind" NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"context" jsonb,
	"remedy" text,
	"reported_by_id" uuid,
	"status" "issue_status" DEFAULT 'open' NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_issues" ADD CONSTRAINT "app_issues_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_issues_open_idx" ON "app_issues" USING btree ("status","last_seen_at");