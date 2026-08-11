CREATE TYPE "public"."seller_market_profile_status" AS ENUM('DRAFT', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "seller_market_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"destination_country_code" text NOT NULL,
	"selling_currency_code" text,
	"locale" text,
	"time_zone" text,
	"status" "seller_market_profile_status" DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"capability_version" text NOT NULL,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"activated_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seller_market_profiles" ADD CONSTRAINT "seller_market_profiles_seller_account_id_seller_accounts_id_fk" FOREIGN KEY ("seller_account_id") REFERENCES "public"."seller_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seller_market_profiles_live_key" ON "seller_market_profiles" USING btree ("seller_account_id","destination_country_code") WHERE "seller_market_profiles"."status" in ('DRAFT', 'ACTIVE');--> statement-breakpoint
CREATE INDEX "seller_market_profiles_seller_idx" ON "seller_market_profiles" USING btree ("seller_account_id");