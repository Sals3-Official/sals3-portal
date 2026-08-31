CREATE TYPE "public"."product_review_flag_reason" AS ENUM('OFF_TOPIC', 'OFFENSIVE', 'SPAM', 'PERSONAL_INFORMATION', 'NOT_A_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."product_review_flag_resolution" AS ENUM('OPEN', 'HIDDEN', 'KEPT');--> statement-breakpoint
CREATE TABLE "sals3_product_review_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"reporter_email" text NOT NULL,
	"reason" "product_review_flag_reason" NOT NULL,
	"resolution" "product_review_flag_resolution" DEFAULT 'OPEN' NOT NULL,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sals3_product_review_flags_reporter_email_lowercase" CHECK ("sals3_product_review_flags"."reporter_email" = lower("sals3_product_review_flags"."reporter_email")),
	CONSTRAINT "sals3_product_review_flags_resolution_stamped" CHECK (("sals3_product_review_flags"."resolution" = 'OPEN') = ("sals3_product_review_flags"."resolved_at" is null))
);
--> statement-breakpoint
CREATE TABLE "sals3_product_review_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"checksum" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width_pixels" integer NOT NULL,
	"height_pixels" integer NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sals3_product_review_photos_position_range" CHECK ("sals3_product_review_photos"."position" between 0 and 3),
	CONSTRAINT "sals3_product_review_photos_dimensions_positive" CHECK ("sals3_product_review_photos"."width_pixels" > 0 and "sals3_product_review_photos"."height_pixels" > 0),
	CONSTRAINT "sals3_product_review_photos_byte_size_positive" CHECK ("sals3_product_review_photos"."byte_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "sals3_product_reviews" ADD COLUMN "delivery_rating" smallint;--> statement-breakpoint
ALTER TABLE "sals3_product_review_flags" ADD CONSTRAINT "sals3_product_review_flags_review_id_sals3_product_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."sals3_product_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sals3_product_review_photos" ADD CONSTRAINT "sals3_product_review_photos_review_id_sals3_product_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."sals3_product_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sals3_product_review_flags_reporter_key" ON "sals3_product_review_flags" USING btree ("review_id","reporter_email");--> statement-breakpoint
CREATE INDEX "sals3_product_review_flags_queue_idx" ON "sals3_product_review_flags" USING btree ("resolution","created_at");--> statement-breakpoint
CREATE INDEX "sals3_product_review_flags_review_idx" ON "sals3_product_review_flags" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sals3_product_review_photos_position_key" ON "sals3_product_review_photos" USING btree ("review_id","position");--> statement-breakpoint
CREATE INDEX "sals3_product_review_photos_review_idx" ON "sals3_product_review_photos" USING btree ("review_id");--> statement-breakpoint
ALTER TABLE "sals3_product_reviews" ADD CONSTRAINT "sals3_product_reviews_delivery_rating_range" CHECK ("sals3_product_reviews"."delivery_rating" is null or "sals3_product_reviews"."delivery_rating" between 1 and 5);