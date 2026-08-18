ALTER TYPE "public"."queue_operation" ADD VALUE 'FULFILL_ORDER';--> statement-breakpoint
CREATE TYPE "public"."checkout_intent_status" AS ENUM('PENDING', 'ACCEPTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."order_payment_status" AS ENUM('PAID', 'REFUNDED', 'DISPUTED');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_group_status" AS ENUM('PENDING', 'CJ_ORDER_CREATED', 'CJ_CART_CONFIRMED', 'CJ_PARENT_ORDER_CREATED', 'CJ_PAID', 'FULFILLMENT_FAILED', 'AWAITING_SUPPLIER_FUNDS');--> statement-breakpoint
CREATE TYPE "public"."supplier_order_step" AS ENUM('CREATE_ORDER_V3', 'ADD_CART', 'ADD_CART_CONFIRM', 'SAVE_GENERATE_PARENT_ORDER', 'PAY_BALANCE_V2');--> statement-breakpoint
CREATE TYPE "public"."supplier_order_step_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "checkout_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "checkout_intent_status" DEFAULT 'PENDING' NOT NULL,
	"buyer_email" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"cart_snapshot" jsonb NOT NULL,
	"address_snapshot" jsonb NOT NULL,
	"freight_snapshot" jsonb NOT NULL,
	"shipping_selection_snapshot" jsonb NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"stripe_event_id" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_intents_amount_non_negative" CHECK ("checkout_intents"."amount_minor" >= 0),
	CONSTRAINT "checkout_intents_currency_shape" CHECK ("checkout_intents"."currency" ~ '^[A-Z]{3}$')
);--> statement-breakpoint
CREATE TABLE "sals3_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"checkout_intent_id" uuid NOT NULL,
	"stripe_checkout_session_id" text NOT NULL,
	"stripe_payment_intent_id" text,
	"payment_status" "order_payment_status" DEFAULT 'PAID' NOT NULL,
	"buyer_email" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sals3_orders_amount_non_negative" CHECK ("sals3_orders"."amount_minor" >= 0)
);--> statement-breakpoint
CREATE TABLE "fulfillment_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"package_id" text NOT NULL,
	"supplier_connection_id" uuid NOT NULL,
	"origin_country" text NOT NULL,
	"destination_country" text NOT NULL,
	"logistic_name" text NOT NULL,
	"option_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"shipping_amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" "fulfillment_group_status" DEFAULT 'PENDING' NOT NULL,
	"cj_order_id" text,
	"cj_shipment_order_id" text,
	"cj_pay_id" text,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "sals3_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"fulfillment_group_id" uuid,
	"store_line_item_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"supplier_connection_id" uuid NOT NULL,
	"external_product_id" text NOT NULL,
	"external_variant_id" text NOT NULL,
	"external_sku" text,
	"sals3_sku" text NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sals3_order_lines_quantity_positive" CHECK ("sals3_order_lines"."quantity" > 0),
	CONSTRAINT "sals3_order_lines_unit_amount_non_negative" CHECK ("sals3_order_lines"."unit_amount_minor" >= 0)
);--> statement-breakpoint
CREATE TABLE "supplier_order_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_group_id" uuid NOT NULL,
	"step" "supplier_order_step" NOT NULL,
	"status" "supplier_order_step_status" DEFAULT 'PENDING' NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_snapshot" jsonb,
	"response_snapshot" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "sals3_orders" ADD CONSTRAINT "sals3_orders_checkout_intent_id_checkout_intents_id_fk" FOREIGN KEY ("checkout_intent_id") REFERENCES "public"."checkout_intents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_groups" ADD CONSTRAINT "fulfillment_groups_order_id_sals3_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sals3_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillment_groups" ADD CONSTRAINT "fulfillment_groups_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sals3_order_lines" ADD CONSTRAINT "sals3_order_lines_order_id_sals3_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sals3_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sals3_order_lines" ADD CONSTRAINT "sals3_order_lines_fulfillment_group_id_fulfillment_groups_id_fk" FOREIGN KEY ("fulfillment_group_id") REFERENCES "public"."fulfillment_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sals3_order_lines" ADD CONSTRAINT "sals3_order_lines_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_order_steps" ADD CONSTRAINT "supplier_order_steps_fulfillment_group_id_fulfillment_groups_id_fk" FOREIGN KEY ("fulfillment_group_id") REFERENCES "public"."fulfillment_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_intents_stripe_session_key" ON "checkout_intents" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_intents_stripe_event_key" ON "checkout_intents" USING btree ("stripe_event_id");--> statement-breakpoint
CREATE INDEX "checkout_intents_status_created_idx" ON "checkout_intents" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sals3_orders_order_number_key" ON "sals3_orders" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sals3_orders_checkout_intent_key" ON "sals3_orders" USING btree ("checkout_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sals3_orders_stripe_session_key" ON "sals3_orders" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillment_groups_order_package_key" ON "fulfillment_groups" USING btree ("order_id","package_id");--> statement-breakpoint
CREATE INDEX "fulfillment_groups_status_idx" ON "fulfillment_groups" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sals3_order_lines_order_store_line_key" ON "sals3_order_lines" USING btree ("order_id","store_line_item_id");--> statement-breakpoint
CREATE INDEX "sals3_order_lines_group_idx" ON "sals3_order_lines" USING btree ("fulfillment_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_order_steps_idempotency_key_key" ON "supplier_order_steps" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_order_steps_group_step_key" ON "supplier_order_steps" USING btree ("fulfillment_group_id","step");
