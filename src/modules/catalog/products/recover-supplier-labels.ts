import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import getDb, { type Database } from '@/lib/db/client';
import {
  productVariants,
  products,
  providerProductReferences,
  providerVariantReferences,
  supplierSnapshots,
} from '@/lib/db/schema';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';

/**
 * Recovering supplier variant labels a draft never recorded.
 *
 * ## Why a product can be missing them
 *
 * `provider_variant_references.source_option_label` has exactly one writer —
 * `create-draft.ts`, at draft time, from `evidence.variants[].optionLabel`. Every
 * variant drafted before that writer shipped carries `NULL`, and re-running the
 * draft path does not repair them: `create-draft` skips a variant whose provider
 * reference already exists, so the column is never revisited.
 *
 * One `NULL` disables option mapping for the whole product, because
 * `deriveOptionSplit` refuses when any variant lacks a label. So the editor shows
 * "Not detected" and the seller cannot name Colour or Size no matter how clean the
 * remaining labels are.
 *
 * ## Where the labels come from
 *
 * `supplier_snapshots.evidence`, which is unique on `candidate_id` and overwritten
 * in place, so it holds current supplier truth. `captureCandidateEvidence` has
 * always stored `optionLabel` per variant — the same field `create-draft.ts`
 * reads.
 *
 * **Zero supplier calls.** Every label is already in the database. No CJ request,
 * no points (ADR-017).
 *
 * ## Three restrictions, each load-bearing
 *
 * It fills only `NULL`, as an `isNull` predicate on the UPDATE rather than a
 * read-then-write, so "only fill blanks" is the database's decision and a
 * concurrent write cannot slip between the check and the write. A label already
 * present is supplier content this must never overwrite.
 *
 * It is scoped to one product owned by the calling seller. `external_variant_id`
 * is CJ's identifier and is not unique across the table — two products, or two
 * *tenants*, can legitimately reference the same CJ variant — so matching on the
 * vid alone would write labels onto another seller's rows.
 *
 * It writes nothing else. Not the SKU, not the cost, not the inventory. Those are
 * live observations with their own write paths, and refreshing them here would be
 * indistinguishable from a real supplier change.
 */

/**
 * Re-validated rather than trusted, mirroring `create-draft.ts`'s
 * `storedVariantSchema`: a snapshot may have been written by an older
 * `EVIDENCE_SCHEMA_VERSION`, and a shape mismatch must degrade to "no usable
 * labels" instead of throwing partway through a transaction.
 */
const storedVariantSchema = z.object({
  vid: z.string().min(1),
  optionLabel: z.string().nullish(),
});

const storedEvidenceSchema = z.object({
  variants: z.array(storedVariantSchema).default([]),
});

export type RecoverSupplierLabelsRefusal =
  'not_found' | 'NO_STORED_EVIDENCE' | 'NO_LABELS_IN_EVIDENCE';

export type RecoverSupplierLabelsResult =
  | { ok: true; recoveredCount: number; alreadyLabelledCount: number }
  | { ok: false; reason: RecoverSupplierLabelsRefusal };

/**
 * A named export and not a default, for the reason `scripts/` keeps proving:
 * `tsx` loads a `.ts` module imported from an `.mts` file through CommonJS
 * interop, and a default arrives wrapped in the module object rather than as the
 * function. `typeof` reports `object`, the call throws, and neither type-check nor
 * `npm run verify` says a word first.
 */
export async function recoverSupplierLabels(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  db?: Database;
}): Promise<RecoverSupplierLabelsResult> {
  const db = input.db ?? getDb();

  return db.transaction(async (tx): Promise<RecoverSupplierLabelsResult> => {
    // Tenant scope in the same predicate that finds the row: not found and not
    // yours answer alike, as every other write path here does.
    const productRows = await tx
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.id, input.productId),
          eq(products.stewardSellerAccountId, input.sellerAccountId),
        ),
      )
      .limit(1);

    if (productRows[0] === undefined) {
      return { ok: false, reason: 'not_found' };
    }

    const snapshotRows = await tx
      .select({ evidence: supplierSnapshots.evidence })
      .from(providerProductReferences)
      .innerJoin(
        supplierSnapshots,
        eq(
          supplierSnapshots.candidateId,
          providerProductReferences.sourceCandidateId,
        ),
      )
      .where(eq(providerProductReferences.productId, input.productId))
      .limit(1);
    const snapshot = snapshotRows[0];

    if (snapshot === undefined) {
      return { ok: false, reason: 'NO_STORED_EVIDENCE' };
    }

    const parsed = storedEvidenceSchema.safeParse(snapshot.evidence);
    const labelled = (parsed.success ? parsed.data.variants : []).flatMap(
      (variant) =>
        variant.optionLabel === null ||
        variant.optionLabel === undefined ||
        variant.optionLabel.trim() === ''
          ? []
          : [{ vid: variant.vid, label: variant.optionLabel.trim() }],
    );

    // An unreadable or label-free snapshot is a fact about the stored evidence,
    // not a failure of this request. Saying so is more useful than reporting a
    // successful run that changed nothing.
    if (labelled.length === 0) {
      return { ok: false, reason: 'NO_LABELS_IN_EVIDENCE' };
    }

    const ownVariantIds = (
      await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.productId, input.productId))
    ).map((row) => row.id);

    if (ownVariantIds.length === 0) {
      return { ok: true, recoveredCount: 0, alreadyLabelledCount: 0 };
    }

    let recoveredCount = 0;

    // eslint-disable-next-line no-restricted-syntax
    for (const entry of labelled) {
      // eslint-disable-next-line no-await-in-loop
      const updated = await tx
        .update(providerVariantReferences)
        .set({ sourceOptionLabel: entry.label })
        .where(
          and(
            inArray(providerVariantReferences.variantId, ownVariantIds),
            eq(providerVariantReferences.externalVariantId, entry.vid),
            isNull(providerVariantReferences.sourceOptionLabel),
          ),
        )
        .returning({ id: providerVariantReferences.id });

      recoveredCount += updated.length;
    }

    const alreadyLabelledCount = labelled.length - recoveredCount;

    if (recoveredCount > 0) {
      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: 'catalog_product.supplier_labels_recovered',
        entityType: 'product',
        entityId: input.productId,
        payload: {
          recoveredCount,
          alreadyLabelledCount,
          source: 'supplier_snapshots.evidence',
        },
      });
    }

    return { ok: true, recoveredCount, alreadyLabelledCount };
  });
}
