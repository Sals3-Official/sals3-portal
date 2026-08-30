import { and, eq, inArray } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import {
  productOptionValues,
  productOptions,
  productVariantOptionValues,
  productVariants,
  products,
} from '@/lib/db/schema';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';

/**
 * Taking a Variant Matrix back off a product.
 *
 * ## Why this could not be built before, and why it can now
 *
 * Both save paths are insert-only, and three separate doc comments in this module
 * family say unmapping "needs its own design — an unmap path, a re-publish story,
 * and a decision about carts already holding a variant". Each of those turned out
 * to have an answer already sitting in the schema, and the answers are what make
 * this safe rather than clever:
 *
 * - **Carts.** The storefront cart is browser-local and holds variant ids. This
 *   deletes no variant, so every cart line still resolves. `checkout_intents`
 *   freezes its own snapshot before payment, and `sals3_order_lines.listing_snapshot`
 *   freezes the buyer-facing axes at intent creation (ADR-007), so a past order
 *   keeps reading `Colour: Black · Size: L` forever regardless of what this does.
 *   There was no decision to make.
 * - **Re-publish.** The storefront selects variants on
 *   `product_offers.publish_state` and joins the three option tables **left**, so
 *   removing them degrades a live PDP to the supplier's own labels rather than
 *   breaking it. Nothing has to be republished for the page to keep working; the
 *   cache does have to be expired, or the page serves named axes that no longer
 *   exist.
 * - **The delisting problem, which does not exist.** The fear was
 *   `product_variants_active_requires_combination`: an `ACTIVE` variant must hold
 *   a combination key, so clearing keys looked like it forced every variant out of
 *   `ACTIVE` first. **Nothing in this codebase ever sets a variant to `ACTIVE`** —
 *   `insertDraftVariant` writes `DRAFT` and no other writer exists — so the CHECK
 *   cannot fire and the keys can simply be cleared. See the warning below about
 *   what else that fact invalidates.
 *
 * ## The delete order is not a preference
 *
 * `product_variant_option_values` references both `product_options` and
 * `product_option_values` with **`ON DELETE restrict`**, so the pairs must go
 * first or the option delete is refused. Deleting `product_options` then cascades
 * to `product_option_values` on its own. This is the same "every RESTRICT edge,
 * innermost first" ordering `purge-catalogue-products.mts` documents, and the
 * reason a FK is a change to every delete path that touches the referenced table.
 *
 * ## The mapping is copied into the audit event before it is destroyed
 *
 * A seller unmaps to fix a wrong assignment, and the buyer-facing labels they
 * typed are not recoverable from anything else: `product_options` has no history
 * table, and the mapping audit records axis *names* but never the per-value
 * labels or which variant took which. So the whole mapping is read and written
 * into `catalog_product.options_unmapped` first. `audit_events` is append-only,
 * which makes that copy the record — the same reasoning as ADR-010's
 * evidence-preservation rule, and the same posture as the discarded draft that
 * freezes rather than deletes.
 *
 * ## Costs nothing at the supplier
 *
 * Reads and deletes rows Sals3 owns. No CJ call, no points (ADR-017).
 */

export type UnmapOptionMappingRefusal =
  'not_found' | 'version_conflict' | 'NOT_MAPPED';

export type UnmapOptionMappingResult =
  | {
      ok: true;
      removedAxisCount: number;
      removedValueCount: number;
      unmappedVariantCount: number;
    }
  | { ok: false; reason: UnmapOptionMappingRefusal };

export default async function unmapOptionMapping(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  expectedProductVersion: number;
  /** Recorded on the audit event. Absent when the seller gave no wording. */
  reason?: string | null;
  db?: Database;
}): Promise<UnmapOptionMappingResult> {
  const db = input.db ?? getDb();
  const now = new Date();

  return db.transaction(async (tx): Promise<UnmapOptionMappingResult> => {
    // Tenant scope and compare-and-set in one predicate, as every other write
    // path in this family does: not found, not yours, and version-moved all
    // answer alike.
    const productRows = await tx
      .select({ id: products.id, version: products.version })
      .from(products)
      .where(
        and(
          eq(products.id, input.productId),
          eq(products.stewardSellerAccountId, input.sellerAccountId),
        ),
      )
      .limit(1);
    const product = productRows[0];

    if (product === undefined) return { ok: false, reason: 'not_found' };
    if (product.version !== input.expectedProductVersion) {
      return { ok: false, reason: 'version_conflict' };
    }

    /**
     * The whole mapping, read before anything is deleted.
     *
     * One row per variant × option, which is the shape the storefront's own read
     * model folds, so what lands in the audit event is what a buyer was being
     * shown rather than a reconstruction of it.
     */
    const mapping = await tx
      .select({
        optionId: productOptions.id,
        optionName: productOptions.name,
        optionPosition: productOptions.position,
        valueId: productOptionValues.id,
        valueLabel: productOptionValues.label,
        valueNormalized: productOptionValues.normalizedValue,
        valuePosition: productOptionValues.position,
        variantId: productVariantOptionValues.variantId,
      })
      .from(productOptions)
      .leftJoin(
        productOptionValues,
        eq(productOptionValues.optionId, productOptions.id),
      )
      // `left`, so an axis whose values were somehow lost still appears in the
      // record of what was removed rather than vanishing from it.
      .leftJoin(
        productVariantOptionValues,
        eq(productVariantOptionValues.optionValueId, productOptionValues.id),
      )
      .where(eq(productOptions.productId, input.productId));

    if (mapping.length === 0) return { ok: false, reason: 'NOT_MAPPED' };

    const optionIds = [...new Set(mapping.map((row) => row.optionId))];
    const valueIds = [
      ...new Set(
        mapping.flatMap((row) => (row.valueId === null ? [] : [row.valueId])),
      ),
    ];

    // Every variant of the product, not only the mapped ones: the key is being
    // cleared on all of them, and a variant that was never linked has a null key
    // already, so the UPDATE is idempotent for it.
    const variantRows = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.productId, input.productId));
    const variantIds = variantRows.map((row) => row.id);

    // ---- deletes, innermost RESTRICT edge first --------------------------
    if (variantIds.length > 0) {
      await tx
        .delete(productVariantOptionValues)
        .where(inArray(productVariantOptionValues.variantId, variantIds));
    }

    // Cascades to `product_option_values`. Deleting the options is only legal
    // once the pairs above are gone.
    await tx
      .delete(productOptions)
      .where(inArray(productOptions.id, optionIds));

    if (variantIds.length > 0) {
      await tx
        .update(productVariants)
        .set({ optionCombinationKey: null, updatedAt: now })
        .where(inArray(productVariants.id, variantIds));
    }

    await tx
      .update(products)
      .set({
        version: input.expectedProductVersion + 1,
        updatedAt: now,
        updatedBy: input.actorId,
      })
      .where(
        and(
          eq(products.id, input.productId),
          // Re-asserted at the write: a concurrent edit between the read and
          // here must lose rather than be silently overwritten.
          eq(products.version, input.expectedProductVersion),
        ),
      );

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: 'catalog_product.options_unmapped',
      entityType: 'product',
      entityId: input.productId,
      payload: {
        removedAxisCount: optionIds.length,
        removedValueCount: valueIds.length,
        unmappedVariantCount: variantIds.length,
        reason: input.reason ?? null,
        /**
         * The mapping itself, so this is reversible by a person reading the
         * trail. Nothing else holds the buyer-facing labels or which variant took
         * which value — `product_options` has no history table, and neither
         * mapping action records them.
         */
        removed: mapping.map((row) => ({
          optionName: row.optionName,
          optionPosition: row.optionPosition,
          valueLabel: row.valueLabel,
          valueNormalized: row.valueNormalized,
          valuePosition: row.valuePosition,
          variantId: row.variantId,
        })),
      },
    });

    return {
      ok: true,
      removedAxisCount: optionIds.length,
      removedValueCount: valueIds.length,
      unmappedVariantCount: variantIds.length,
    };
  });
}
