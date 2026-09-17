CREATE TYPE "public"."confirmation_method" AS ENUM('dm', 'phone');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'setter', 'closer');--> statement-breakpoint
CREATE TABLE "calendly_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"calendly_invitee_uri" text,
	"payload" jsonb NOT NULL,
	"matched_lead_id" uuid,
	"match_strategy" text,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eod_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"report_date" text NOT NULL,
	"total_outbounds" integer,
	"total_follow_ups" integer,
	"total_leads_with_replies" integer,
	"youtube_videos_sent" integer,
	"calls_pitched" integer,
	"calls_booked" integer,
	"cash_collected" numeric(12, 2),
	"revenue_generated" numeric(12, 2),
	"win" text,
	"obstacle" text,
	"focus_tomorrow" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ig_handle" text NOT NULL,
	"ig_handle_key" text,
	"name" text,
	"email" text,
	"phone" text,
	"setter_id" uuid,
	"lead_source" text,
	"opener" text,
	"conversation_stage" text,
	"lead_quality" text,
	"icp" text,
	"outbound_dm" boolean DEFAULT false NOT NULL,
	"responded" boolean DEFAULT false NOT NULL,
	"responded_at" timestamp with time zone,
	"follow_ups" integer DEFAULT 0 NOT NULL,
	"last_contact_at" timestamp with time zone,
	"next_follow_up_at" timestamp with time zone,
	"offer_id" uuid,
	"call_booked" boolean DEFAULT false NOT NULL,
	"call_booked_at" timestamp with time zone,
	"call_scheduled_for" timestamp with time zone,
	"closer_id" uuid,
	"closer_name" text,
	"calendly_event_uri" text,
	"calendly_invitee_uri" text,
	"calendly_cancel_url" text,
	"calendly_reschedule_url" text,
	"call_cancelled" boolean DEFAULT false NOT NULL,
	"call_cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"showed" boolean,
	"confirmed" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_id" uuid,
	"confirmation_method" "confirmation_method",
	"triaged" boolean DEFAULT false NOT NULL,
	"triaged_at" timestamp with time zone,
	"triaged_by_id" uuid,
	"triage_notes" text,
	"lead_created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"airtable_record_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_airtable_record_id_unique" UNIQUE("airtable_record_id")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"scheduling_url" text NOT NULL,
	"event_type_uri" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "offers_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "option_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'setter' NOT NULL,
	"discord_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "calendly_webhook_events" ADD CONSTRAINT "calendly_webhook_events_matched_lead_id_leads_id_fk" FOREIGN KEY ("matched_lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eod_reports" ADD CONSTRAINT "eod_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_setter_id_users_id_fk" FOREIGN KEY ("setter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_closer_id_users_id_fk" FOREIGN KEY ("closer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_confirmed_by_id_users_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_triaged_by_id_users_id_fk" FOREIGN KEY ("triaged_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendly_events_unmatched_idx" ON "calendly_webhook_events" USING btree ("matched_lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eod_user_date_idx" ON "eod_reports" USING btree ("user_id","report_date");--> statement-breakpoint
CREATE INDEX "lead_events_lead_idx" ON "lead_events" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_notes_lead_idx" ON "lead_notes" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_ig_handle_key_idx" ON "leads" USING btree ("ig_handle_key");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "leads_setter_idx" ON "leads" USING btree ("setter_id");--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("conversation_stage");--> statement-breakpoint
CREATE INDEX "leads_scheduled_idx" ON "leads" USING btree ("call_scheduled_for");--> statement-breakpoint
CREATE INDEX "leads_next_follow_up_idx" ON "leads" USING btree ("next_follow_up_at");--> statement-breakpoint
CREATE UNIQUE INDEX "option_sets_kind_value_idx" ON "option_sets" USING btree ("kind","value");