CREATE TABLE "calendly_event_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uri" text NOT NULL,
	"name" text NOT NULL,
	"booking_count" integer DEFAULT 0 NOT NULL,
	"counted" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendly_event_types_uri_unique" UNIQUE("uri")
);
--> statement-breakpoint
-- The links already connected to an offer keep counting, so a deploy doesn't
-- silently stop accepting bookings while the rest of the list is filled in.
INSERT INTO calendly_event_types (uri, name, counted)
SELECT event_type_uri, label, TRUE
FROM offers
WHERE event_type_uri IS NOT NULL
ON CONFLICT (uri) DO NOTHING;
