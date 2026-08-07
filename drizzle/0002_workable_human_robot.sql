CREATE TYPE "public"."evaluation_status" AS ENUM('QUEUED', 'EVALUATING', 'PASS', 'PASS_WITH_ATTENTION', 'TEMPORARILY_INELIGIBLE', 'BLOCKED', 'EVALUATION_FAILED');--> statement-breakpoint
CREATE TABLE "candidate_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"status" "evaluation_status" DEFAULT 'QUEUED' NOT NULL,
	"reason_codes" text[] DEFAULT '{}' NOT NULL,
	"evidence_summary" jsonb,
	"source_snapshot_checksum" text,
	"policy_version" text NOT NULL,
	"score" integer,
	"last_known_price_usd_cents" integer,
	"last_seen_fingerprint" text NOT NULL,
	"feed_snapshot" jsonb NOT NULL,
	"leased_by" text,
	"leased_until" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"next_retry_at" timestamp with time zone,
	"evaluated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_evaluations" ADD CONSTRAINT "candidate_evaluations_candidate_id_supplier_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."supplier_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_evaluations_candidate_id_key" ON "candidate_evaluations" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "candidate_evaluations_status_idx" ON "candidate_evaluations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "candidate_evaluations_next_retry_at_idx" ON "candidate_evaluations" USING btree ("next_retry_at");