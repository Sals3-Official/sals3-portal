CREATE TABLE "supplier_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"schema_version" text NOT NULL,
	"checksum" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_snapshots" ADD CONSTRAINT "supplier_snapshots_candidate_id_supplier_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."supplier_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_snapshots_candidate_id_key" ON "supplier_snapshots" USING btree ("candidate_id");