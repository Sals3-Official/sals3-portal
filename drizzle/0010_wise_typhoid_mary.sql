CREATE TYPE "public"."discovery_audit_unit_state" AS ENUM('DUE', 'RUNNING', 'STABLE', 'CHANGED', 'UNRESOLVED');--> statement-breakpoint
CREATE TYPE "public"."discovery_lane" AS ENUM('BOOTSTRAP', 'INCREMENTAL', 'AUDIT');--> statement-breakpoint
CREATE TYPE "public"."discovery_range_obligation_state" AS ENUM('OPEN', 'RETRYING', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."subscription_priority_class" AS ENUM('ORDER_LINKED', 'LIVE', 'SELECTED_IMPORTING', 'READY', 'NONE');--> statement-breakpoint
ALTER TYPE "public"."queue_operation" ADD VALUE 'DISCOVERY_AUDIT_UNIT' BEFORE 'EVALUATE_CANDIDATE';--> statement-breakpoint
CREATE TABLE "discovery_audit_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partition_proof_id" uuid NOT NULL,
	"state" "discovery_audit_unit_state" DEFAULT 'DUE' NOT NULL,
	"observed_provider_total" integer,
	"observed_unique_pid_count" integer,
	"observed_checksum" text,
	"added_product_ids" text[] DEFAULT '{}' NOT NULL,
	"missing_product_ids" text[] DEFAULT '{}' NOT NULL,
	"missing_confirmed" boolean DEFAULT false NOT NULL,
	"last_error_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_incremental_watermarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_connection_id" uuid NOT NULL,
	"generation_key" text DEFAULT 'default' NOT NULL,
	"bootstrap_cutoff" timestamp with time zone,
	"proven_cutoff" timestamp with time zone,
	"next_window_from" timestamp with time zone,
	"safety_overlap_seconds" integer NOT NULL,
	"category_snapshot_checksum" text,
	"state_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_partition_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_connection_id" uuid NOT NULL,
	"source_partition_id" uuid NOT NULL,
	"generation_key" text DEFAULT 'default' NOT NULL,
	"category_id" text NOT NULL,
	"create_time_from_ms" bigint,
	"create_time_to_ms" bigint NOT NULL,
	"price_from_cents" integer,
	"price_to_cents" integer,
	"provider_total" integer NOT NULL,
	"unique_pid_count" integer NOT NULL,
	"sorted_pid_checksum" text NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_audited_at" timestamp with time zone,
	"next_audit_due_at" timestamp with time zone,
	"audit_risk_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_range_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_connection_id" uuid NOT NULL,
	"lane" "discovery_lane" NOT NULL,
	"generation_key" text DEFAULT 'default' NOT NULL,
	"cycle_id" uuid,
	"category_id" text,
	"range_from" timestamp with time zone,
	"range_to" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"state" "discovery_range_obligation_state" DEFAULT 'OPEN' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"next_retry_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "provider_last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "provider_last_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "provider_removal_suspected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "provider_removal_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discovery_cycles" ADD COLUMN "lane" "discovery_lane" DEFAULT 'BOOTSTRAP' NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_cycles" ADD COLUMN "generation_key" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "discovery_cycles" ADD COLUMN "window_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discovery_cycles" ADD COLUMN "safety_overlap_seconds" integer;--> statement-breakpoint
ALTER TABLE "discovery_cycles" ADD COLUMN "proof_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_subscriptions" ADD COLUMN "priority_class" "subscription_priority_class" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_subscriptions" ADD COLUMN "desired_reason" text;--> statement-breakpoint
ALTER TABLE "product_subscriptions" ADD COLUMN "provider_result" text;--> statement-breakpoint
ALTER TABLE "supplier_request_budgets" ADD COLUMN "provider_pause_reason" text;--> statement-breakpoint
ALTER TABLE "supplier_request_budgets" ADD COLUMN "background_points_spent_today" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_request_budgets" ADD COLUMN "critical_headroom_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_request_budgets" ADD COLUMN "next_safe_refill_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discovery_audit_units" ADD CONSTRAINT "discovery_audit_units_partition_proof_id_discovery_partition_proofs_id_fk" FOREIGN KEY ("partition_proof_id") REFERENCES "public"."discovery_partition_proofs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_incremental_watermarks" ADD CONSTRAINT "discovery_incremental_watermarks_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_partition_proofs" ADD CONSTRAINT "discovery_partition_proofs_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_partition_proofs" ADD CONSTRAINT "discovery_partition_proofs_source_partition_id_discovery_partitions_id_fk" FOREIGN KEY ("source_partition_id") REFERENCES "public"."discovery_partitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_range_obligations" ADD CONSTRAINT "discovery_range_obligations_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_range_obligations" ADD CONSTRAINT "discovery_range_obligations_cycle_id_discovery_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."discovery_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_audit_units_state_due_idx" ON "discovery_audit_units" USING btree ("state","next_retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_incremental_watermarks_connection_generation_key" ON "discovery_incremental_watermarks" USING btree ("supplier_connection_id","generation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_partition_proofs_source_partition_key" ON "discovery_partition_proofs" USING btree ("source_partition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_partition_proofs_logical_key" ON "discovery_partition_proofs" USING btree ("supplier_connection_id","generation_key","category_id","create_time_from_ms","create_time_to_ms","price_from_cents","price_to_cents");--> statement-breakpoint
CREATE INDEX "discovery_partition_proofs_audit_due_idx" ON "discovery_partition_proofs" USING btree ("next_audit_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_range_obligations_logical_key" ON "discovery_range_obligations" USING btree ("supplier_connection_id","lane","generation_key","category_id","range_from","range_to","reason");--> statement-breakpoint
CREATE INDEX "discovery_range_obligations_state_due_idx" ON "discovery_range_obligations" USING btree ("state","next_retry_at");--> statement-breakpoint
CREATE INDEX "supplier_candidates_provider_freshness_idx" ON "supplier_candidates" USING btree ("provider_last_seen_at","provider_last_verified_at");--> statement-breakpoint
CREATE INDEX "discovery_cycles_connection_lane_idx" ON "discovery_cycles" USING btree ("supplier_connection_id","lane","state");