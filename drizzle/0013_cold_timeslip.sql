CREATE TYPE "public"."category_mapping_confidence" AS ENUM('EXACT', 'ACCEPTABLE', 'AMBIGUOUS', 'UNMAPPED');--> statement-breakpoint
CREATE TYPE "public"."offer_availability_state" AS ENUM('UNKNOWN', 'AVAILABLE', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."offer_fulfillment_mode" AS ENUM('SALS3_STOCK', 'SUPPLIER_DROPSHIP', 'THIRD_PARTY_WAREHOUSE', 'DIGITAL');--> statement-breakpoint
CREATE TYPE "public"."offer_pricing_state" AS ENUM('UNRESOLVED', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."offer_publish_state" AS ENUM('UNPUBLISHED', 'PUBLISHED', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."offer_supplier_binding_state" AS ENUM('UNVERIFIED', 'ACTIVE', 'SUSPENDED', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."product_age_group" AS ENUM('NEWBORN', 'INFANT', 'TODDLER', 'KIDS', 'ADULT');--> statement-breakpoint
CREATE TYPE "public"."product_brand_mode" AS ENUM('UNBRANDED', 'DECLARED');--> statement-breakpoint
CREATE TYPE "public"."product_condition" AS ENUM('NEW', 'REFURBISHED', 'USED');--> statement-breakpoint
CREATE TYPE "public"."product_gender" AS ENUM('MALE', 'FEMALE', 'UNISEX');--> statement-breakpoint
CREATE TYPE "public"."product_media_preference" AS ENUM('SELLER_FIRST', 'SUPPLIER_ONLY');--> statement-breakpoint
CREATE TYPE "public"."product_media_review_state" AS ENUM('NOT_REVIEWED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."product_media_rights_basis" AS ENUM('UNKNOWN', 'SUPPLIER_TERMS', 'SELLER_DECLARED');--> statement-breakpoint
CREATE TYPE "public"."product_media_source_type" AS ENUM('SUPPLIER_ORIGINAL', 'SELLER_UPLOAD');--> statement-breakpoint
CREATE TYPE "public"."product_publication_state" AS ENUM('UNPUBLISHED', 'PUBLISHED', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."product_revision_approval_mode" AS ENUM('AUTO', 'MANUAL_EXCEPTION');--> statement-breakpoint
CREATE TYPE "public"."product_revision_workflow_state" AS ENUM('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."product_variant_status" AS ENUM('DRAFT', 'ACTIVE', 'UNAVAILABLE', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."provider_source_status" AS ENUM('UNKNOWN', 'ACTIVE', 'INACTIVE', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."provider_sync_state" AS ENUM('HEALTHY', 'STALE', 'CONFLICT', 'ERROR', 'DISABLED');--> statement-breakpoint
CREATE TABLE "offer_supplier_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"supplier_connection_id" uuid NOT NULL,
	"provider_variant_reference_id" uuid NOT NULL,
	"state" "offer_supplier_binding_state" DEFAULT 'UNVERIFIED' NOT NULL,
	"state_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_media_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"source_type" "product_media_source_type" NOT NULL,
	"source_url" text,
	"source_external_id" text,
	"checksum" text,
	"content_type" text,
	"byte_size" integer,
	"width_pixels" integer,
	"height_pixels" integer,
	"rights_basis" "product_media_rights_basis" DEFAULT 'UNKNOWN' NOT NULL,
	"review_state" "product_media_review_state" DEFAULT 'NOT_REVIEWED' NOT NULL,
	"merchant_center_eligible" boolean,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "product_media_sources_dimensions_non_negative" CHECK (("product_media_sources"."byte_size" IS NULL OR "product_media_sources"."byte_size" >= 0)
        AND ("product_media_sources"."width_pixels" IS NULL OR "product_media_sources"."width_pixels" >= 0)
        AND ("product_media_sources"."height_pixels" IS NULL OR "product_media_sources"."height_pixels" >= 0)),
	CONSTRAINT "product_media_sources_approved_requires_rights" CHECK ("product_media_sources"."review_state" <> 'APPROVED' OR "product_media_sources"."rights_basis" <> 'UNKNOWN')
);
--> statement-breakpoint
CREATE TABLE "product_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"market_code" text NOT NULL,
	"fulfillment_mode" "offer_fulfillment_mode" NOT NULL,
	"price_amount_minor" bigint,
	"price_currency" text,
	"compare_at_amount_minor" bigint,
	"compare_at_currency" text,
	"comparison_evidence_id" text,
	"availability_state" "offer_availability_state" DEFAULT 'UNKNOWN' NOT NULL,
	"publish_state" "offer_publish_state" DEFAULT 'UNPUBLISHED' NOT NULL,
	"pricing_state" "offer_pricing_state" DEFAULT 'UNRESOLVED' NOT NULL,
	"pricing_unavailable_reason" text,
	"pricing_resolver_version" text,
	"pricing_decision" jsonb,
	"market_profile_id" uuid,
	"market_capability_version" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "product_offers_price_paired" CHECK (("product_offers"."price_amount_minor" IS NULL) = ("product_offers"."price_currency" IS NULL)),
	CONSTRAINT "product_offers_price_non_negative" CHECK ("product_offers"."price_amount_minor" IS NULL OR "product_offers"."price_amount_minor" >= 0),
	CONSTRAINT "product_offers_published_requires_price" CHECK ("product_offers"."publish_state" <> 'PUBLISHED' OR "product_offers"."price_amount_minor" IS NOT NULL),
	CONSTRAINT "product_offers_compare_at_requires_evidence" CHECK ("product_offers"."compare_at_amount_minor" IS NULL OR ("product_offers"."comparison_evidence_id" IS NOT NULL AND "product_offers"."compare_at_currency" IS NOT NULL)),
	CONSTRAINT "product_offers_pricing_state_explained" CHECK (("product_offers"."pricing_state" = 'RESOLVED' AND "product_offers"."pricing_resolver_version" IS NOT NULL AND "product_offers"."price_amount_minor" IS NOT NULL)
        OR ("product_offers"."pricing_state" = 'UNRESOLVED' AND "product_offers"."pricing_unavailable_reason" IS NOT NULL)),
	CONSTRAINT "product_offers_market_code_shape" CHECK ("product_offers"."market_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "product_option_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"option_id" uuid NOT NULL,
	"label" text NOT NULL,
	"normalized_value" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_option_values_position_non_negative" CHECK ("product_option_values"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_options_position_non_negative" CHECK ("product_options"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "product_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"workflow_state" "product_revision_workflow_state" DEFAULT 'DRAFT' NOT NULL,
	"content_document" jsonb NOT NULL,
	"content_checksum" text NOT NULL,
	"content_snapshot" jsonb,
	"frozen_at" timestamp with time zone,
	"media_preference" "product_media_preference" DEFAULT 'SELLER_FIRST' NOT NULL,
	"expected_product_version" integer NOT NULL,
	"approval_mode" "product_revision_approval_mode",
	"approval_policy_version" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	CONSTRAINT "product_revisions_frozen_when_settled" CHECK ("product_revisions"."workflow_state" NOT IN ('APPROVED', 'SUPERSEDED') OR ("product_revisions"."content_snapshot" IS NOT NULL AND "product_revisions"."frozen_at" IS NOT NULL)),
	CONSTRAINT "product_revisions_approved_records_mode" CHECK ("product_revisions"."workflow_state" <> 'APPROVED' OR ("product_revisions"."approval_mode" IS NOT NULL AND "product_revisions"."approval_policy_version" IS NOT NULL AND "product_revisions"."approved_at" IS NOT NULL)),
	CONSTRAINT "product_revisions_number_positive" CHECK ("product_revisions"."revision_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "product_variant_option_values" (
	"variant_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"option_value_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sals3_sku" text NOT NULL,
	"status" "product_variant_status" DEFAULT 'DRAFT' NOT NULL,
	"option_combination_key" text,
	"gtins" text[],
	"mpn" text,
	"identifier_exists" boolean DEFAULT true NOT NULL,
	"weight_grams" integer,
	"length_millimeters" integer,
	"width_millimeters" integer,
	"height_millimeters" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"first_published_at" timestamp with time zone,
	CONSTRAINT "product_variants_active_requires_combination" CHECK ("product_variants"."status" <> 'ACTIVE' OR "product_variants"."option_combination_key" IS NOT NULL),
	CONSTRAINT "product_variants_gtin_cardinality" CHECK ("product_variants"."gtins" IS NULL OR cardinality("product_variants"."gtins") <= 10),
	CONSTRAINT "product_variants_dimensions_non_negative" CHECK (("product_variants"."weight_grams" IS NULL OR "product_variants"."weight_grams" >= 0)
        AND ("product_variants"."length_millimeters" IS NULL OR "product_variants"."length_millimeters" >= 0)
        AND ("product_variants"."width_millimeters" IS NULL OR "product_variants"."width_millimeters" >= 0)
        AND ("product_variants"."height_millimeters" IS NULL OR "product_variants"."height_millimeters" >= 0))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"steward_seller_account_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text,
	"category_id" uuid,
	"category_mapping_confidence" "category_mapping_confidence" DEFAULT 'UNMAPPED' NOT NULL,
	"brand_mode" "product_brand_mode" DEFAULT 'UNBRANDED' NOT NULL,
	"brand_name" text,
	"google_product_category" text,
	"condition" "product_condition",
	"age_group" "product_age_group",
	"gender" "product_gender",
	"publication_state" "product_publication_state" DEFAULT 'UNPUBLISHED' NOT NULL,
	"current_revision_id" uuid,
	"published_revision_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	CONSTRAINT "products_published_requires_revision" CHECK ("products"."publication_state" <> 'PUBLISHED' OR "products"."published_revision_id" IS NOT NULL),
	CONSTRAINT "products_published_requires_slug" CHECK ("products"."publication_state" <> 'PUBLISHED' OR "products"."slug" IS NOT NULL),
	CONSTRAINT "products_declared_brand_requires_name" CHECK ("products"."brand_mode" <> 'DECLARED' OR "products"."brand_name" IS NOT NULL),
	CONSTRAINT "products_category_mapping_consistent" CHECK (("products"."category_id" IS NULL) = ("products"."category_mapping_confidence" = 'UNMAPPED'))
);
--> statement-breakpoint
CREATE TABLE "provider_product_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"supplier_provider_id" uuid NOT NULL,
	"external_product_id" text NOT NULL,
	"source_candidate_id" uuid,
	"source_status" "provider_source_status" DEFAULT 'UNKNOWN' NOT NULL,
	"sync_state" "provider_sync_state" DEFAULT 'STALE' NOT NULL,
	"snapshot_checksum" text,
	"last_observed_at" timestamp with time zone,
	"last_successful_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_variant_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_product_reference_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"external_variant_id" text NOT NULL,
	"external_sku" text,
	"source_option_label" text,
	"source_status" "provider_source_status" DEFAULT 'UNKNOWN' NOT NULL,
	"last_observed_cost_minor" bigint,
	"last_observed_cost_currency" text,
	"last_observed_inventory" integer,
	"last_observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_variant_references_cost_paired" CHECK (("provider_variant_references"."last_observed_cost_minor" IS NULL) = ("provider_variant_references"."last_observed_cost_currency" IS NULL)),
	CONSTRAINT "provider_variant_references_cost_non_negative" CHECK ("provider_variant_references"."last_observed_cost_minor" IS NULL OR "provider_variant_references"."last_observed_cost_minor" >= 0),
	CONSTRAINT "provider_variant_references_inventory_non_negative" CHECK ("provider_variant_references"."last_observed_inventory" IS NULL OR "provider_variant_references"."last_observed_inventory" >= 0)
);
--> statement-breakpoint
ALTER TABLE "offer_supplier_bindings" ADD CONSTRAINT "offer_supplier_bindings_offer_id_product_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."product_offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_supplier_bindings" ADD CONSTRAINT "offer_supplier_bindings_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_supplier_bindings" ADD CONSTRAINT "offer_supplier_bindings_provider_variant_reference_id_provider_variant_references_id_fk" FOREIGN KEY ("provider_variant_reference_id") REFERENCES "public"."provider_variant_references"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media_sources" ADD CONSTRAINT "product_media_sources_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_media_sources" ADD CONSTRAINT "product_media_sources_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_seller_account_id_seller_accounts_id_fk" FOREIGN KEY ("seller_account_id") REFERENCES "public"."seller_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_values" ADD CONSTRAINT "product_option_values_option_id_product_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."product_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_revisions" ADD CONSTRAINT "product_revisions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_option_id_product_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."product_options"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variant_option_values" ADD CONSTRAINT "product_variant_option_values_option_value_id_product_option_values_id_fk" FOREIGN KEY ("option_value_id") REFERENCES "public"."product_option_values"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_steward_seller_account_id_seller_accounts_id_fk" FOREIGN KEY ("steward_seller_account_id") REFERENCES "public"."seller_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_sals3_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."sals3_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_current_revision_id_product_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."product_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_published_revision_id_product_revisions_id_fk" FOREIGN KEY ("published_revision_id") REFERENCES "public"."product_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_product_references" ADD CONSTRAINT "provider_product_references_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_product_references" ADD CONSTRAINT "provider_product_references_supplier_provider_id_supplier_providers_id_fk" FOREIGN KEY ("supplier_provider_id") REFERENCES "public"."supplier_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_product_references" ADD CONSTRAINT "provider_product_references_source_candidate_id_supplier_candidates_id_fk" FOREIGN KEY ("source_candidate_id") REFERENCES "public"."supplier_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_variant_references" ADD CONSTRAINT "provider_variant_references_provider_product_reference_id_provider_product_references_id_fk" FOREIGN KEY ("provider_product_reference_id") REFERENCES "public"."provider_product_references"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_variant_references" ADD CONSTRAINT "provider_variant_references_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offer_supplier_bindings_active_key" ON "offer_supplier_bindings" USING btree ("offer_id") WHERE "offer_supplier_bindings"."state" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "offer_supplier_bindings_offer_connection_variant_key" ON "offer_supplier_bindings" USING btree ("offer_id","supplier_connection_id","provider_variant_reference_id");--> statement-breakpoint
CREATE INDEX "offer_supplier_bindings_connection_idx" ON "offer_supplier_bindings" USING btree ("supplier_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_media_sources_product_checksum_key" ON "product_media_sources" USING btree ("product_id","checksum") WHERE "product_media_sources"."checksum" is not null;--> statement-breakpoint
CREATE INDEX "product_media_sources_product_idx" ON "product_media_sources" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_offers_seller_variant_market_mode_key" ON "product_offers" USING btree ("seller_account_id","variant_id","market_code","fulfillment_mode");--> statement-breakpoint
CREATE INDEX "product_offers_seller_idx" ON "product_offers" USING btree ("seller_account_id");--> statement-breakpoint
CREATE INDEX "product_offers_variant_idx" ON "product_offers" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_option_values_option_normalized_key" ON "product_option_values" USING btree ("option_id","normalized_value");--> statement-breakpoint
CREATE UNIQUE INDEX "product_option_values_option_position_key" ON "product_option_values" USING btree ("option_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "product_options_product_normalized_name_key" ON "product_options" USING btree ("product_id","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "product_options_product_position_key" ON "product_options" USING btree ("product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "product_revisions_product_number_key" ON "product_revisions" USING btree ("product_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "product_revisions_open_draft_key" ON "product_revisions" USING btree ("product_id") WHERE "product_revisions"."workflow_state" = 'DRAFT';--> statement-breakpoint
CREATE INDEX "product_revisions_product_state_idx" ON "product_revisions" USING btree ("product_id","workflow_state");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_option_values_variant_option_key" ON "product_variant_option_values" USING btree ("variant_id","option_id");--> statement-breakpoint
CREATE INDEX "product_variant_option_values_value_idx" ON "product_variant_option_values" USING btree ("option_value_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_sals3_sku_key" ON "product_variants" USING btree ("sals3_sku");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_active_combination_key" ON "product_variants" USING btree ("product_id","option_combination_key") WHERE "product_variants"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "product_variants_product_status_idx" ON "product_variants" USING btree ("product_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "products_public_slug_key" ON "products" USING btree ("slug") WHERE "products"."publication_state" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "products_steward_idx" ON "products" USING btree ("steward_seller_account_id");--> statement-breakpoint
CREATE INDEX "products_publication_state_idx" ON "products" USING btree ("publication_state");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_product_references_provider_external_key" ON "provider_product_references" USING btree ("supplier_provider_id","external_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_product_references_product_provider_key" ON "provider_product_references" USING btree ("product_id","supplier_provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_variant_references_reference_external_key" ON "provider_variant_references" USING btree ("provider_product_reference_id","external_variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_variant_references_variant_key" ON "provider_variant_references" USING btree ("variant_id");