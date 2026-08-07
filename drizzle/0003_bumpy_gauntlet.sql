CREATE TYPE "public"."seller_account_state" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."seller_business_model" AS ENUM('RETAILER', 'DROPSHIPPER');--> statement-breakpoint
CREATE TYPE "public"."seller_verification_state" AS ENUM('PENDING', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."supplier_provider_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."supplier_connection_status" AS ENUM('PENDING', 'CONNECTED', 'DEGRADED', 'REAUTH_REQUIRED', 'DISCONNECTED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "seller_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" text NOT NULL,
	"business_model" "seller_business_model" NOT NULL,
	"verification_state" "seller_verification_state" DEFAULT 'PENDING' NOT NULL,
	"account_state" "seller_account_state" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "supplier_provider_status" DEFAULT 'ACTIVE' NOT NULL,
	"capabilities" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_account_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"external_account_lookup_hash" text NOT NULL,
	"external_account_masked" text NOT NULL,
	"status" "supplier_connection_status" DEFAULT 'PENDING' NOT NULL,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "supplier_connection_secrets" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"ciphertext_base64" text NOT NULL,
	"iv_base64" text NOT NULL,
	"auth_tag_base64" text NOT NULL,
	"key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "supplier_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_connections" ADD CONSTRAINT "supplier_connections_seller_account_id_seller_accounts_id_fk" FOREIGN KEY ("seller_account_id") REFERENCES "public"."seller_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_connections" ADD CONSTRAINT "supplier_connections_provider_id_supplier_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."supplier_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_connection_secrets" ADD CONSTRAINT "supplier_connection_secrets_connection_id_supplier_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seller_accounts_identity_id_key" ON "seller_accounts" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "seller_accounts_business_model_idx" ON "seller_accounts" USING btree ("business_model");--> statement-breakpoint
CREATE INDEX "seller_accounts_account_state_idx" ON "seller_accounts" USING btree ("account_state");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_providers_code_key" ON "supplier_providers" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_connections_seller_provider_key" ON "supplier_connections" USING btree ("seller_account_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_connections_provider_external_hash_key" ON "supplier_connections" USING btree ("provider_id","external_account_lookup_hash");--> statement-breakpoint
CREATE INDEX "supplier_connections_seller_status_idx" ON "supplier_connections" USING btree ("seller_account_id","status");--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD CONSTRAINT "supplier_candidates_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;