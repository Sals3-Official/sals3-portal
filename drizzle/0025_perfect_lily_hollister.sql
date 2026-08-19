-- 0025: buyer-orders read model — tracking, parcel state, frozen variant label.
--
-- HAND-EDITED to be idempotent after generation: these statements were already
-- applied to production on 2026-08-19 (as the since-renumbered
-- 0024_orange_centennial, journal created_at 1787151319369) before
-- 0024_spicy_nemesis landed on develop and took the 0024 slot. The journal
-- entry for this file keeps that same `when`, so drizzle-kit treats it as
-- applied in production; the IF NOT EXISTS guards make the file safe either
-- way — a database at 0024 gets the delta, a database that already has it
-- no-ops.
CREATE TABLE IF NOT EXISTS "parcel_tracking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_group_id" uuid NOT NULL,
	"source" text NOT NULL,
	"label" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"is_exception" boolean DEFAULT false NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parcel_tracking_events_source_known" CHECK ("parcel_tracking_events"."source" in ('CARRIER', 'SUPPLIER', 'OPERATIONS'))
);
--> statement-breakpoint
ALTER TABLE "fulfillment_groups" ADD COLUMN IF NOT EXISTS "parcel_state" text;--> statement-breakpoint
ALTER TABLE "fulfillment_groups" ADD COLUMN IF NOT EXISTS "tracking_number" text;--> statement-breakpoint
ALTER TABLE "fulfillment_groups" ADD COLUMN IF NOT EXISTS "supplier_status_raw" text;--> statement-breakpoint
ALTER TABLE "fulfillment_groups" ADD COLUMN IF NOT EXISTS "carrier_delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fulfillment_groups" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sals3_order_lines" ADD COLUMN IF NOT EXISTS "variant_label" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "parcel_tracking_events" ADD CONSTRAINT "parcel_tracking_events_fulfillment_group_id_fulfillment_groups_id_fk" FOREIGN KEY ("fulfillment_group_id") REFERENCES "public"."fulfillment_groups"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "parcel_tracking_events_group_dedupe_key" ON "parcel_tracking_events" USING btree ("fulfillment_group_id","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "parcel_tracking_events_group_time_idx" ON "parcel_tracking_events" USING btree ("fulfillment_group_id","occurred_at");
