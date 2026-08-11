CREATE TYPE "public"."category_remap_review_status" AS ENUM('OPEN', 'RESOLVED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."provider_category_mapping_method" AS ENUM('EXTERNAL_ID_RULE', 'REVIEWED_PATH_RULE');--> statement-breakpoint
CREATE TYPE "public"."provider_category_mapping_review_status" AS ENUM('PENDING_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."provider_category_mapping_status" AS ENUM('PROPOSED', 'ACTIVE', 'SUPERSEDED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "category_remap_review_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_candidate_id" uuid,
	"affected_candidates_enumerated" boolean DEFAULT false NOT NULL,
	"provider" "supplier" NOT NULL,
	"external_category_id" text NOT NULL,
	"previous_mapping_id" uuid NOT NULL,
	"previous_mapping_version" integer NOT NULL,
	"new_mapping_id" uuid,
	"new_mapping_version" integer,
	"status" "category_remap_review_status" DEFAULT 'OPEN' NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_category_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "supplier" NOT NULL,
	"external_category_id" text NOT NULL,
	"observed_category_path" text,
	"sals3_category_id" uuid,
	"taxonomy_version" text NOT NULL,
	"mapping_version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"method" "provider_category_mapping_method" NOT NULL,
	"confidence" "category_mapping_confidence" NOT NULL,
	"review_status" "provider_category_mapping_review_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"status" "provider_category_mapping_status" DEFAULT 'PROPOSED' NOT NULL,
	"reason" text NOT NULL,
	"evidence_reference" text,
	"actor_id" text NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_category_mappings_external_id_not_blank" CHECK (length(btrim("provider_category_mappings"."external_category_id")) > 0),
	CONSTRAINT "provider_category_mappings_version_positive" CHECK ("provider_category_mappings"."mapping_version" >= 1),
	CONSTRAINT "provider_category_mappings_target_matches_confidence" CHECK (("provider_category_mappings"."confidence" in ('EXACT','ACCEPTABLE') and "provider_category_mappings"."sals3_category_id" is not null)
          or ("provider_category_mappings"."confidence" in ('AMBIGUOUS','UNMAPPED') and "provider_category_mappings"."sals3_category_id" is null)),
	CONSTRAINT "provider_category_mappings_active_requires_approval" CHECK ("provider_category_mappings"."status" <> 'ACTIVE' or "provider_category_mappings"."review_status" = 'APPROVED')
);
--> statement-breakpoint
CREATE TABLE "sals3_category_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"taxonomy_version" text NOT NULL,
	"variation_architecture" text,
	"tier_1_attribute" text,
	"tier_2_attribute" text,
	"sku_format_standard" text,
	"required_item_attributes" text[] DEFAULT '{}' NOT NULL,
	"required_item_attributes_raw" text,
	"store_catalogue_status" text,
	"product_examples" text,
	"source_workbook" text NOT NULL,
	"source_sheet" text NOT NULL,
	"source_checksum" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_category_mapping_consistent";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category_mapping_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category_mapping_version" integer;--> statement-breakpoint
ALTER TABLE "category_remap_review_findings" ADD CONSTRAINT "category_remap_review_findings_supplier_candidate_id_supplier_candidates_id_fk" FOREIGN KEY ("supplier_candidate_id") REFERENCES "public"."supplier_candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_remap_review_findings" ADD CONSTRAINT "category_remap_review_findings_previous_mapping_id_provider_category_mappings_id_fk" FOREIGN KEY ("previous_mapping_id") REFERENCES "public"."provider_category_mappings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_remap_review_findings" ADD CONSTRAINT "category_remap_review_findings_new_mapping_id_provider_category_mappings_id_fk" FOREIGN KEY ("new_mapping_id") REFERENCES "public"."provider_category_mappings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_category_mappings" ADD CONSTRAINT "provider_category_mappings_sals3_category_id_sals3_categories_id_fk" FOREIGN KEY ("sals3_category_id") REFERENCES "public"."sals3_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sals3_category_presets" ADD CONSTRAINT "sals3_category_presets_category_id_sals3_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."sals3_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_remap_review_findings_candidate_previous_key" ON "category_remap_review_findings" USING btree ("supplier_candidate_id","previous_mapping_id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_remap_review_findings_summary_key" ON "category_remap_review_findings" USING btree ("previous_mapping_id") WHERE "category_remap_review_findings"."supplier_candidate_id" is null;--> statement-breakpoint
CREATE INDEX "category_remap_review_findings_open_idx" ON "category_remap_review_findings" USING btree ("provider","external_category_id") WHERE "category_remap_review_findings"."status" = 'OPEN';--> statement-breakpoint
CREATE UNIQUE INDEX "provider_category_mappings_active_key" ON "provider_category_mappings" USING btree ("provider","external_category_id") WHERE "provider_category_mappings"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "provider_category_mappings_version_key" ON "provider_category_mappings" USING btree ("provider","external_category_id","mapping_version");--> statement-breakpoint
CREATE INDEX "provider_category_mappings_category_idx" ON "provider_category_mappings" USING btree ("sals3_category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sals3_category_presets_category_version_key" ON "sals3_category_presets" USING btree ("category_id","taxonomy_version");--> statement-breakpoint
CREATE INDEX "sals3_category_presets_version_idx" ON "sals3_category_presets" USING btree ("taxonomy_version");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_mapping_id_provider_category_mappings_id_fk" FOREIGN KEY ("category_mapping_id") REFERENCES "public"."provider_category_mappings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_mapping_provenance_complete" CHECK (("products"."category_mapping_id" IS NULL) = ("products"."category_mapping_version" IS NULL)
          and ("products"."category_mapping_id" IS NULL or "products"."category_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_mapping_consistent" CHECK (("products"."category_id" IS NOT NULL) = ("products"."category_mapping_confidence" IN ('EXACT','ACCEPTABLE')));