DROP INDEX "supplier_candidates_supplier_external_product_id_key";--> statement-breakpoint
ALTER TABLE "supplier_candidates" ALTER COLUMN "supplier_connection_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_candidates_connection_external_product_key" ON "supplier_candidates" USING btree ("supplier_connection_id","external_product_id");--> statement-breakpoint
CREATE INDEX "supplier_candidates_connection_state_idx" ON "supplier_candidates" USING btree ("supplier_connection_id","shortlist_state");