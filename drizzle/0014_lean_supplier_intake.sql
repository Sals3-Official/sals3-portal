CREATE TYPE "public"."stock_review_state" AS ENUM('STOCK_NOT_CHECKED', 'MANUALLY_IN_STOCK', 'MANUALLY_NO_INVENTORY', 'MANUALLY_COULD_NOT_VERIFY');--> statement-breakpoint
CREATE TYPE "public"."discovery_backlog_gate_state" AS ENUM('PENDING_ACTIVATION', 'DRAINING', 'DRAIN_COMPLETE');--> statement-breakpoint
CREATE TYPE "public"."discovery_curated_lane" AS ENUM('CJ_TRENDING', 'CJ_MOST_LISTED', 'CJ_NEW_ARRIVALS');--> statement-breakpoint
CREATE TYPE "public"."discovery_curated_lane_state" AS ENUM('IDLE', 'RUNNING', 'PAUSED', 'EXHAUSTED');--> statement-breakpoint
CREATE TYPE "public"."discovery_signal" AS ENUM('CJ_TRENDING', 'CJ_HIGH_LISTED', 'CJ_NEW_ARRIVAL');--> statement-breakpoint
ALTER TYPE "public"."queue_operation" ADD VALUE 'DISCOVERY_CURATED_LANE' BEFORE 'EVALUATE_CANDIDATE';--> statement-breakpoint
CREATE TABLE "candidate_discovery_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"signal" "discovery_signal" NOT NULL,
	"source_lane" text NOT NULL,
	"source_query" text,
	"observed_listed_num" integer,
	"first_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"observation_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_stock_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"state" "stock_review_state" NOT NULL,
	"actor_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"observed_quantity" integer,
	"observed_origin" text,
	"note" text,
	"superseded_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_stock_attestations_quantity_non_negative" CHECK ("candidate_stock_attestations"."observed_quantity" IS NULL OR "candidate_stock_attestations"."observed_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "discovery_backlog_gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_connection_id" uuid NOT NULL,
	"activation_at" timestamp with time zone NOT NULL,
	"baseline_backlog_count" integer DEFAULT 0 NOT NULL,
	"state" "discovery_backlog_gate_state" DEFAULT 'DRAINING' NOT NULL,
	"last_observed_backlog" integer,
	"last_evaluated_at" timestamp with time zone,
	"drain_completed_at" timestamp with time zone,
	"state_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_curated_lanes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_connection_id" uuid NOT NULL,
	"lane" "discovery_curated_lane" NOT NULL,
	"state" "discovery_curated_lane_state" DEFAULT 'IDLE' NOT NULL,
	"next_page" integer DEFAULT 1 NOT NULL,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"window_from_ms" bigint,
	"window_to_ms" bigint,
	"new_pids_admitted" integer DEFAULT 0 NOT NULL,
	"signals_recorded" integer DEFAULT 0 NOT NULL,
	"last_pause_reason" text,
	"last_error_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"leased_until" timestamp with time zone,
	"state_version" integer DEFAULT 1 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_curated_lanes_next_page_positive" CHECK ("discovery_curated_lanes"."next_page" >= 1)
);
--> statement-breakpoint
CREATE TABLE "discovery_pid_capacities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_connection_id" uuid NOT NULL,
	"limit_value" integer NOT NULL,
	"admitted_count" integer DEFAULT 0 NOT NULL,
	"last_admitted_at" timestamp with time zone,
	"cap_reached_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_pid_capacities_within_limit" CHECK ("discovery_pid_capacities"."admitted_count" <= "discovery_pid_capacities"."limit_value"),
	CONSTRAINT "discovery_pid_capacities_non_negative" CHECK ("discovery_pid_capacities"."admitted_count" >= 0 AND "discovery_pid_capacities"."limit_value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "provider_category_id" text;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "provider_category_name" text;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "stock_review_state" "stock_review_state" DEFAULT 'STOCK_NOT_CHECKED' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "stock_review_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "stock_review_observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "stock_review_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "stock_review_actor_id" text;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "stock_review_observed_quantity" integer;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "stock_review_observed_origin" text;--> statement-breakpoint
ALTER TABLE "supplier_candidates" ADD COLUMN "stock_review_note" text;--> statement-breakpoint
ALTER TABLE "candidate_discovery_signals" ADD CONSTRAINT "candidate_discovery_signals_candidate_id_supplier_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."supplier_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_stock_attestations" ADD CONSTRAINT "candidate_stock_attestations_candidate_id_supplier_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."supplier_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_backlog_gates" ADD CONSTRAINT "discovery_backlog_gates_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_curated_lanes" ADD CONSTRAINT "discovery_curated_lanes_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_pid_capacities" ADD CONSTRAINT "discovery_pid_capacities_supplier_connection_id_supplier_connections_id_fk" FOREIGN KEY ("supplier_connection_id") REFERENCES "public"."supplier_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_discovery_signals_candidate_signal_key" ON "candidate_discovery_signals" USING btree ("candidate_id","signal");--> statement-breakpoint
CREATE INDEX "candidate_discovery_signals_signal_idx" ON "candidate_discovery_signals" USING btree ("signal");--> statement-breakpoint
CREATE INDEX "candidate_stock_attestations_candidate_idx" ON "candidate_stock_attestations" USING btree ("candidate_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_backlog_gates_connection_key" ON "discovery_backlog_gates" USING btree ("supplier_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_curated_lanes_connection_lane_key" ON "discovery_curated_lanes" USING btree ("supplier_connection_id","lane");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_pid_capacities_connection_key" ON "discovery_pid_capacities" USING btree ("supplier_connection_id");--> statement-breakpoint
CREATE INDEX "supplier_candidates_connection_category_idx" ON "supplier_candidates" USING btree ("supplier_connection_id","provider_category_id");--> statement-breakpoint
CREATE INDEX "supplier_candidates_connection_stock_review_idx" ON "supplier_candidates" USING btree ("supplier_connection_id","stock_review_state");