CREATE TABLE "supplier_account_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"external_account_lookup_hash" text NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"first_bound_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_account_bindings" ADD CONSTRAINT "supplier_account_bindings_provider_id_supplier_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."supplier_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_account_bindings" ADD CONSTRAINT "supplier_account_bindings_seller_account_id_seller_accounts_id_fk" FOREIGN KEY ("seller_account_id") REFERENCES "public"."seller_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_account_bindings_provider_hash_key" ON "supplier_account_bindings" USING btree ("provider_id","external_account_lookup_hash");--> statement-breakpoint
CREATE INDEX "supplier_account_bindings_seller_idx" ON "supplier_account_bindings" USING btree ("seller_account_id");--> statement-breakpoint
-- Backfill, hand-written: every provider account a seller has ever connected
-- becomes a permanent binding, including DISCONNECTED ones. That is the
-- intent - a disconnect releases the configuration, never the ownership.
-- `first_bound_at` takes the connection's own `created_at` so the ledger does
-- not claim these bindings started at migration time.
INSERT INTO "supplier_account_bindings"
  ("provider_id", "external_account_lookup_hash", "seller_account_id", "first_bound_at")
SELECT "provider_id", "external_account_lookup_hash", "seller_account_id", "created_at"
FROM "supplier_connections"
ON CONFLICT ("provider_id", "external_account_lookup_hash") DO NOTHING;