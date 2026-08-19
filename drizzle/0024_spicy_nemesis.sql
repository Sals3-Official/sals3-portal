CREATE TABLE "pricing_store_defaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"target_margin_rate" numeric(8, 6) NOT NULL,
	"min_contribution_minor" bigint DEFAULT 0 NOT NULL,
	"min_contribution_currency" text DEFAULT 'USD' NOT NULL,
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
ALTER TABLE "pricing_store_defaults" ADD CONSTRAINT "pricing_store_defaults_seller_account_id_seller_accounts_id_fk" FOREIGN KEY ("seller_account_id") REFERENCES "public"."seller_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_store_defaults_active_key" ON "pricing_store_defaults" USING btree ("seller_account_id") WHERE "pricing_store_defaults"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "pricing_store_defaults_seller_idx" ON "pricing_store_defaults" USING btree ("seller_account_id");
