CREATE TYPE "public"."funding_rail" AS ENUM('CJ_WALLET_WIRE_TRANSFER', 'CJ_WALLET_PAYONEER', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."pricing_override_status" AS ENUM('ACTIVE', 'SUPERSEDED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."pricing_policy_status" AS ENUM('ACTIVE', 'SUPERSEDED', 'DEACTIVATED');--> statement-breakpoint
CREATE TYPE "public"."rounding_rule" AS ENUM('NONE', 'NEAREST_0_99');--> statement-breakpoint
CREATE TYPE "public"."taxonomy_status" AS ENUM('ADOPTED', 'PILOT_VALIDATED', 'PRODUCTION_READY');--> statement-breakpoint
CREATE TABLE "pricing_category_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"target_margin_rate" numeric(8, 6) NOT NULL,
	"rounding_rule" "rounding_rule" DEFAULT 'NONE' NOT NULL,
	"status" "pricing_policy_status" DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_fx_adjustment_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"source_currency" text NOT NULL,
	"target_currency" text NOT NULL,
	"funding_rail" "funding_rail" NOT NULL,
	"adjustment_rate" numeric(8, 6) NOT NULL,
	"status" "pricing_policy_status" DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_product_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_candidate_id" uuid NOT NULL,
	"target_margin_rate" numeric(8, 6) NOT NULL,
	"status" "pricing_override_status" DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_variant_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_candidate_id" uuid NOT NULL,
	"supplier_variant_id" text NOT NULL,
	"target_margin_rate" numeric(8, 6) NOT NULL,
	"status" "pricing_override_status" DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"reason" text NOT NULL,
	"additional_justification" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sals3_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"l1" text,
	"l2" text,
	"l3" text,
	"l4" text,
	"l5" text,
	"path" text NOT NULL,
	"taxonomy_status" "taxonomy_status" DEFAULT 'ADOPTED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pricing_category_policies" ADD CONSTRAINT "pricing_category_policies_seller_account_id_seller_accounts_id_fk" FOREIGN KEY ("seller_account_id") REFERENCES "public"."seller_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_category_policies" ADD CONSTRAINT "pricing_category_policies_category_id_sals3_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."sals3_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_fx_adjustment_policies" ADD CONSTRAINT "pricing_fx_adjustment_policies_seller_account_id_seller_accounts_id_fk" FOREIGN KEY ("seller_account_id") REFERENCES "public"."seller_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_product_overrides" ADD CONSTRAINT "pricing_product_overrides_supplier_candidate_id_supplier_candidates_id_fk" FOREIGN KEY ("supplier_candidate_id") REFERENCES "public"."supplier_candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_variant_overrides" ADD CONSTRAINT "pricing_variant_overrides_supplier_candidate_id_supplier_candidates_id_fk" FOREIGN KEY ("supplier_candidate_id") REFERENCES "public"."supplier_candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_category_policies_active_key" ON "pricing_category_policies" USING btree ("seller_account_id","category_id") WHERE "pricing_category_policies"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "pricing_category_policies_seller_idx" ON "pricing_category_policies" USING btree ("seller_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_fx_adjustment_policies_active_key" ON "pricing_fx_adjustment_policies" USING btree ("seller_account_id","source_currency","target_currency","funding_rail") WHERE "pricing_fx_adjustment_policies"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "pricing_fx_adjustment_policies_seller_idx" ON "pricing_fx_adjustment_policies" USING btree ("seller_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_product_overrides_active_key" ON "pricing_product_overrides" USING btree ("supplier_candidate_id") WHERE "pricing_product_overrides"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_variant_overrides_active_key" ON "pricing_variant_overrides" USING btree ("supplier_candidate_id","supplier_variant_id") WHERE "pricing_variant_overrides"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "sals3_categories_code_key" ON "sals3_categories" USING btree ("code");--> statement-breakpoint
CREATE INDEX "sals3_categories_l1_idx" ON "sals3_categories" USING btree ("l1");