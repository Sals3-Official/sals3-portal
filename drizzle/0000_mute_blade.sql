CREATE TYPE "public"."shortlist_state" AS ENUM('SHORTLISTED', 'PREFLIGHT_PENDING');--> statement-breakpoint
CREATE TYPE "public"."supplier" AS ENUM('CJ_DROPSHIPPING');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"actor_id" text NOT NULL,
	"operation" text NOT NULL,
	"request_hash" text NOT NULL,
	"result_reference" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier" "supplier" NOT NULL,
	"external_product_id" text NOT NULL,
	"intended_seller_id" text NOT NULL,
	"intended_market_codes" text[] NOT NULL,
	"shortlist_state" "shortlist_state" DEFAULT 'SHORTLISTED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_key_key" ON "idempotency_records" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_candidates_supplier_external_product_id_key" ON "supplier_candidates" USING btree ("supplier","external_product_id");--> statement-breakpoint
CREATE INDEX "supplier_candidates_intended_seller_id_idx" ON "supplier_candidates" USING btree ("intended_seller_id");