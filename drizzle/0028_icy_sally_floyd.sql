CREATE TYPE "public"."product_review_reply_status" AS ENUM('PUBLISHED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."product_review_status" AS ENUM('PUBLISHED', 'HIDDEN_BY_PLATFORM');--> statement-breakpoint
CREATE TABLE "sals3_product_review_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"reply_version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"status" "product_review_reply_status" DEFAULT 'PUBLISHED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sals3_product_review_replies_version_positive" CHECK ("sals3_product_review_replies"."reply_version" >= 1),
	CONSTRAINT "sals3_product_review_replies_body_length" CHECK (char_length("sals3_product_review_replies"."body") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "sals3_product_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_line_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"seller_account_id" uuid NOT NULL,
	"buyer_email" text NOT NULL,
	"display_name" text,
	"rating" smallint NOT NULL,
	"body" text,
	"status" "product_review_status" DEFAULT 'PUBLISHED' NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sals3_product_reviews_rating_range" CHECK ("sals3_product_reviews"."rating" between 1 and 5),
	CONSTRAINT "sals3_product_reviews_body_length" CHECK ("sals3_product_reviews"."body" is null or char_length("sals3_product_reviews"."body") <= 1000),
	CONSTRAINT "sals3_product_reviews_display_name_length" CHECK ("sals3_product_reviews"."display_name" is null or char_length("sals3_product_reviews"."display_name") between 1 and 60),
	CONSTRAINT "sals3_product_reviews_buyer_email_lowercase" CHECK ("sals3_product_reviews"."buyer_email" = lower("sals3_product_reviews"."buyer_email"))
);
--> statement-breakpoint
ALTER TABLE "sals3_product_review_replies" ADD CONSTRAINT "sals3_product_review_replies_review_id_sals3_product_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."sals3_product_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sals3_product_review_replies" ADD CONSTRAINT "sals3_product_review_replies_seller_account_id_seller_accounts_id_fk" FOREIGN KEY ("seller_account_id") REFERENCES "public"."seller_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sals3_product_reviews" ADD CONSTRAINT "sals3_product_reviews_order_line_id_sals3_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."sals3_order_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sals3_product_reviews" ADD CONSTRAINT "sals3_product_reviews_order_id_sals3_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sals3_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sals3_product_reviews" ADD CONSTRAINT "sals3_product_reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sals3_product_reviews" ADD CONSTRAINT "sals3_product_reviews_seller_account_id_seller_accounts_id_fk" FOREIGN KEY ("seller_account_id") REFERENCES "public"."seller_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sals3_product_review_replies_active_key" ON "sals3_product_review_replies" USING btree ("review_id") WHERE "sals3_product_review_replies"."status" = 'PUBLISHED';--> statement-breakpoint
CREATE UNIQUE INDEX "sals3_product_review_replies_version_key" ON "sals3_product_review_replies" USING btree ("review_id","reply_version");--> statement-breakpoint
CREATE INDEX "sals3_product_review_replies_seller_idx" ON "sals3_product_review_replies" USING btree ("seller_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sals3_product_reviews_line_key" ON "sals3_product_reviews" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "sals3_product_reviews_product_idx" ON "sals3_product_reviews" USING btree ("product_id","status","created_at");--> statement-breakpoint
CREATE INDEX "sals3_product_reviews_seller_idx" ON "sals3_product_reviews" USING btree ("seller_account_id","created_at");--> statement-breakpoint
CREATE INDEX "sals3_product_reviews_buyer_idx" ON "sals3_product_reviews" USING btree ("buyer_email");