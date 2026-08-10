CREATE TYPE "public"."discovery_cycle_state" AS ENUM('SEEDING', 'RUNNING', 'COMPLETE', 'COVERAGE_UNRESOLVED');--> statement-breakpoint
CREATE TYPE "public"."discovery_partition_state" AS ENUM('PENDING', 'RECONCILING', 'SPLIT', 'COVERED', 'PROVIDER_COVERAGE_UNRESOLVED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."discovery_run_desired_state" AS ENUM('RUNNING', 'PAUSED');--> statement-breakpoint
CREATE TYPE "public"."outbox_state" AS ENUM('PENDING', 'DISPATCHED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."queue_operation" AS ENUM('DISCOVERY_CYCLE_START', 'DISCOVERY_PARTITION', 'EVALUATE_CANDIDATE', 'RECONCILE_PRODUCT', 'WEBHOOK_EVENT', 'OUTBOX_DISPATCH');--> statement-breakpoint
CREATE TYPE "public"."subscription_desired_state" AS ENUM('SUBSCRIBED', 'UNSUBSCRIBED');--> statement-breakpoint
CREATE TYPE "public"."subscription_observed_state" AS ENUM('UNKNOWN', 'SUBSCRIBED', 'UNSUBSCRIBED');--> statement-breakpoint
CREATE TYPE "public"."webhook_inbox_state" AS ENUM('PENDING', 'PROCESSED', 'FAILED');--> statement-breakpoint
CREATE TABLE "discovery_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier" "supplier" DEFAULT 'CJ_DROPSHIPPING' NOT NULL,
	"supplier_connection_id" uuid NOT NULL,
	"cycle_cutoff" timestamp with time zone NOT NULL,
	"state" "discovery_cycle_state" DEFAULT 'SEEDING' NOT NULL,
	"category_snapshot" jsonb,
	"seed_cursor" integer DEFAULT 0 NOT NULL,
	"partitions_total" integer DEFAULT 0 NOT NULL,
	"partitions_terminal" integer DEFAULT 0 NOT NULL,
	"partitions_unresolved" integer DEFAULT 0 NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_cycles_terminal_within_total" CHECK ("discovery_cycles"."partitions_terminal" <= "discovery_cycles"."partitions_total"),
	CONSTRAINT "discovery_cycles_unresolved_within_terminal" CHECK ("discovery_cycles"."partitions_unresolved" <= "discovery_cycles"."partitions_terminal")
);
--> statement-breakpoint
CREATE TABLE "discovery_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"reference_id" text NOT NULL,
	"error_code" text NOT NULL,
	"detail" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_partitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"supplier_connection_id" uuid NOT NULL,
	"parent_partition_id" uuid,
	"depth" integer DEFAULT 0 NOT NULL,
	"category_id" text NOT NULL,
	"create_time_from_ms" bigint,
	"create_time_to_ms" bigint NOT NULL,
	"price_from_cents" integer,
	"price_to_cents" integer,
	"state" "discovery_partition_state" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"reported_total" integer,
	"unique_pid_count" integer,
	"pass_checksums" text[] DEFAULT '{}' NOT NULL,
	"reconcile_pass" integer,
	"reconcile_next_page" integer,
	"reconcile_attempts" integer DEFAULT 0 NOT NULL,
	"unresolved_reason" text,
	"lease_token" text,
	"leased_until" timestamp with time zone,
	"state_version" integer DEFAULT 1 NOT NULL,
	"covered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_partitions_depth_non_negative" CHECK ("discovery_partitions"."depth" >= 0),
	CONSTRAINT "discovery_partitions_time_bounds_ordered" CHECK ("discovery_partitions"."create_time_from_ms" IS NULL OR "discovery_partitions"."create_time_from_ms" < "discovery_partitions"."create_time_to_ms"),
	CONSTRAINT "discovery_partitions_price_bounds_ordered" CHECK ("discovery_partitions"."price_from_cents" IS NULL OR "discovery_partitions"."price_to_cents" IS NULL OR "discovery_partitions"."price_from_cents" < "discovery_partitions"."price_to_cents")
);
--> statement-breakpoint
CREATE TABLE "discovery_reconcile_pids" (
	"partition_id" uuid NOT NULL,
	"pass" integer NOT NULL,
	"pid" text NOT NULL,
	CONSTRAINT "discovery_reconcile_pids_partition_id_pass_pid_pk" PRIMARY KEY("partition_id","pass","pid")
);
--> statement-breakpoint
CREATE TABLE "discovery_run_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_connection_id" uuid NOT NULL,
	"desired_state" "discovery_run_desired_state" DEFAULT 'PAUSED' NOT NULL,
	"state_version" integer DEFAULT 1 NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_paused_at" timestamp with time zone,
	"last_resumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_connection_id" uuid NOT NULL,
	"external_product_id" text NOT NULL,
	"desired_state" "subscription_desired_state" NOT NULL,
	"observed_state" "subscription_observed_state" DEFAULT 'UNKNOWN' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"last_verified_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_request_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_connection_id" uuid NOT NULL,
	"last_request_at" timestamp with time zone,
	"points_total" integer,
	"points_used_today" integer,
	"points_remaining" integer,
	"points_observed_at" timestamp with time zone,
	"paused_until" timestamp with time zone,
	"observed_subscription_limit" integer,
	"state_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_webhook_secrets" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"ciphertext_base64" text NOT NULL,
	"iv_base64" text NOT NULL,
	"auth_tag_base64" text NOT NULL,
	"key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier" "supplier" DEFAULT 'CJ_DROPSHIPPING' NOT NULL,
	"supplier_connection_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"event_type" text NOT NULL,
	"operation" text,
	"payload" jsonb NOT NULL,
	"state" "webhook_inbox_state" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation" "queue_operation" NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"not_before" timestamp with time zone,
	"state" "outbox_state" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"lease_token" text,
	"leased_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_evaluations" ADD COLUMN "next_refresh_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discovery_cycles" ADD CONSTRAINT "discovery_cycles_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_partitions" ADD CONSTRAINT "discovery_partitions_cycle_id_discovery_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."discovery_cycles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_partitions" ADD CONSTRAINT "discovery_partitions_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_reconcile_pids" ADD CONSTRAINT "discovery_reconcile_pids_partition_id_discovery_partitions_id_fk" FOREIGN KEY ("partition_id") REFERENCES "public"."discovery_partitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_run_states" ADD CONSTRAINT "discovery_run_states_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_subscriptions" ADD CONSTRAINT "product_subscriptions_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_request_budgets" ADD CONSTRAINT "supplier_request_budgets_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_webhook_secrets" ADD CONSTRAINT "supplier_webhook_secrets_connection_id_supplier_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_inbox" ADD CONSTRAINT "webhook_inbox_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_cycles_one_active_per_connection" ON "discovery_cycles" USING btree ("supplier_connection_id") WHERE "discovery_cycles"."state" IN ('SEEDING', 'RUNNING');--> statement-breakpoint
CREATE INDEX "discovery_cycles_connection_state_idx" ON "discovery_cycles" USING btree ("supplier_connection_id","state");--> statement-breakpoint
CREATE INDEX "discovery_failures_scope_idx" ON "discovery_failures" USING btree ("scope","created_at");--> statement-breakpoint
CREATE INDEX "discovery_partitions_cycle_state_idx" ON "discovery_partitions" USING btree ("cycle_id","state");--> statement-breakpoint
CREATE INDEX "discovery_partitions_connection_idx" ON "discovery_partitions" USING btree ("supplier_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_run_states_connection_key" ON "discovery_run_states" USING btree ("supplier_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_subscriptions_connection_product_key" ON "product_subscriptions" USING btree ("supplier_connection_id","external_product_id");--> statement-breakpoint
CREATE INDEX "product_subscriptions_desired_observed_idx" ON "product_subscriptions" USING btree ("desired_state","observed_state");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_request_budgets_connection_key" ON "supplier_request_budgets" USING btree ("supplier_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_inbox_connection_message_key" ON "webhook_inbox" USING btree ("supplier_connection_id","message_id");--> statement-breakpoint
CREATE INDEX "webhook_inbox_state_idx" ON "webhook_inbox" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "work_outbox_idempotency_key_key" ON "work_outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "work_outbox_state_not_before_idx" ON "work_outbox" USING btree ("state","not_before");--> statement-breakpoint
CREATE INDEX "candidate_evaluations_next_refresh_at_idx" ON "candidate_evaluations" USING btree ("next_refresh_at");