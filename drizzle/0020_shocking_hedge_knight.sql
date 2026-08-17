CREATE TYPE "public"."attribute_aeo_geo_visibility" AS ENUM('ANSWER_SUMMARY_USEFUL', 'ATTRIBUTE_CONTEXT_ONLY');--> statement-breakpoint
CREATE TYPE "public"."attribute_compliance_review_flag" AS ENUM('STANDARD_CATALOG_REVIEW', 'WARRANTY_TERMS_COMPLIANCE', 'FOOD_SAFETY_REGISTRATION', 'REGULATED_HEALTH_SAFETY_CLAIM', 'EXPIRATION_AND_SHELF_LIFE', 'COSMETIC_REGULATORY_NOTIFICATION', 'VEHICLE_FITMENT_CRITICAL', 'CHILD_SAFETY_CERTIFICATION', 'LEGAL_IDENTIFIER_VERIFICATION', 'DIGITAL_LICENSE_VALIDATION', 'DIGITAL_DELIVERY_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."attribute_data_type" AS ENUM('STRING', 'STRING_ARRAY');--> statement-breakpoint
CREATE TYPE "public"."attribute_input_control_type" AS ENUM('SINGLE_SELECT_DROPDOWN', 'MULTI_SELECT_DROPDOWN', 'TEXT_INPUT', 'NUMBER_INPUT', 'MEASUREMENT_INPUT', 'BOOLEAN_TOGGLE', 'DATE_PICKER');--> statement-breakpoint
CREATE TYPE "public"."attribute_requirement_level" AS ENUM('REQUIRED', 'RECOMMENDED', 'OPTIONAL');--> statement-breakpoint
CREATE TYPE "public"."attribute_seo_visibility" AS ENUM('PDP_VISIBLE', 'STRUCTURED_DATA_ELIGIBLE', 'ATTRIBUTE_CONTEXT_ONLY');--> statement-breakpoint
CREATE TABLE "category_attribute_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"controls_version" text NOT NULL,
	"attribute_name" text NOT NULL,
	"requirement_level" "attribute_requirement_level" NOT NULL,
	"input_control_type" "attribute_input_control_type" NOT NULL,
	"allowed_values" text[] DEFAULT '{}' NOT NULL,
	"allow_custom_value" boolean NOT NULL,
	"allow_multiple_values" boolean NOT NULL,
	"seller_help_text" text,
	"seo_visibility" "attribute_seo_visibility" NOT NULL,
	"aeo_geo_visibility" "attribute_aeo_geo_visibility" NOT NULL,
	"compliance_review_flag" "attribute_compliance_review_flag" NOT NULL,
	"source_basis" text,
	"source_workbook" text NOT NULL,
	"source_sheet" text NOT NULL,
	"source_checksum" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_attribute_controls_name_not_blank" CHECK (length(btrim("category_attribute_controls"."attribute_name")) > 0),
	CONSTRAINT "category_attribute_controls_allowed_values_match_type" CHECK (("category_attribute_controls"."input_control_type" in ('SINGLE_SELECT_DROPDOWN','MULTI_SELECT_DROPDOWN') and array_length("category_attribute_controls"."allowed_values", 1) > 0)
          or ("category_attribute_controls"."input_control_type" not in ('SINGLE_SELECT_DROPDOWN','MULTI_SELECT_DROPDOWN') and coalesce(array_length("category_attribute_controls"."allowed_values", 1), 0) = 0))
);
--> statement-breakpoint
CREATE TABLE "category_attribute_dictionary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"controls_version" text NOT NULL,
	"attribute_name" text NOT NULL,
	"canonical_attribute_key" text NOT NULL,
	"default_input_control_type" "attribute_input_control_type" NOT NULL,
	"default_allowed_values" text[] DEFAULT '{}' NOT NULL,
	"default_allow_custom_value" boolean NOT NULL,
	"default_allow_multiple_values" boolean NOT NULL,
	"data_type" "attribute_data_type" NOT NULL,
	"notes" text,
	"source_workbook" text NOT NULL,
	"source_sheet" text NOT NULL,
	"source_checksum" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_category_attribute_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"attribute_name" text NOT NULL,
	"controls_version" text NOT NULL,
	"values" text[] DEFAULT '{}' NOT NULL,
	"is_custom_value" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "product_category_attribute_values_name_not_blank" CHECK (length(btrim("product_category_attribute_values"."attribute_name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "category_attribute_controls_category_attribute_version_key" ON "category_attribute_controls" USING btree ("category_id","attribute_name","controls_version");--> statement-breakpoint
CREATE INDEX "category_attribute_controls_category_idx" ON "category_attribute_controls" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "category_attribute_controls_version_idx" ON "category_attribute_controls" USING btree ("controls_version");--> statement-breakpoint
CREATE UNIQUE INDEX "category_attribute_dictionary_name_version_key" ON "category_attribute_dictionary" USING btree ("attribute_name","controls_version");--> statement-breakpoint
CREATE UNIQUE INDEX "category_attribute_dictionary_key_version_key" ON "category_attribute_dictionary" USING btree ("canonical_attribute_key","controls_version");--> statement-breakpoint
CREATE UNIQUE INDEX "product_category_attribute_values_product_attribute_key" ON "product_category_attribute_values" USING btree ("product_id","attribute_name");--> statement-breakpoint
CREATE INDEX "product_category_attribute_values_product_idx" ON "product_category_attribute_values" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "category_attribute_controls" ADD CONSTRAINT "category_attribute_controls_category_id_sals3_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."sals3_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_attribute_controls" ADD CONSTRAINT "category_attribute_controls_attribute_name_controls_version_category_attribute_dictionary_attribute_name_controls_version_fk" FOREIGN KEY ("attribute_name","controls_version") REFERENCES "public"."category_attribute_dictionary"("attribute_name","controls_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category_attribute_values" ADD CONSTRAINT "product_category_attribute_values_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;