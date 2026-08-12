DROP INDEX "pricing_fx_adjustment_policies_active_key";--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_fx_adjustment_policies_active_key" ON "pricing_fx_adjustment_policies" USING btree ("seller_account_id") WHERE "pricing_fx_adjustment_policies"."status" = 'ACTIVE';--> statement-breakpoint
ALTER TABLE "pricing_fx_adjustment_policies" DROP COLUMN "source_currency";--> statement-breakpoint
ALTER TABLE "pricing_fx_adjustment_policies" DROP COLUMN "target_currency";--> statement-breakpoint
ALTER TABLE "pricing_fx_adjustment_policies" DROP COLUMN "funding_rail";--> statement-breakpoint
DROP TYPE "public"."funding_rail";