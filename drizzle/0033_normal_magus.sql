ALTER TABLE "checkout_intents" ADD COLUMN "buyer_uid" text;--> statement-breakpoint
ALTER TABLE "sals3_orders" ADD COLUMN "buyer_uid" text;--> statement-breakpoint
CREATE INDEX "sals3_orders_buyer_uid_idx" ON "sals3_orders" USING btree ("buyer_uid");