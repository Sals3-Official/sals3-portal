import { eq, inArray } from 'drizzle-orm';
import {
  productOptionValues,
  productOptions,
  productVariantOptionValues,
  productVariants,
} from '@/lib/db/schema';
import type { Executor } from '@/modules/catalog/candidates/repository';

/**
 * Reading and removing a saved Variant Matrix — the half three paths share.
 *
 * `unmapOptionMapping` removes one, `remapOptionMapping` removes one and writes
 * another in the same transaction, and `restoreOptionMapping` needs the read to
 * refuse a product that already has one. The delete order below is a correctness
 * property rather than a style, so it gets exactly one home: the same rule in
 * three files, drifting, is the most repeated defect in this codebase.
 *
 * The writer is `write-option-mapping.ts`. These two are deliberately not in it:
 * a module that both builds and destroys the same rows invites a caller to do
 * both without deciding which it meant.
 */

export type OptionMappingRow = {
  optionId: string;
  optionName: string;
  optionPosition: number;
  valueId: string | null;
  valueLabel: string | null;
  valueNormalized: string | null;
  valuePosition: number | null;
  variantId: string | null;
};

/**
 * The whole mapping, one row per variant × option.
 *
 * The same shape the storefront's own read model folds, so a snapshot taken from
 * this is what a buyer was being shown rather than a reconstruction of it.
 *
 * Both joins are `left`, so an axis whose values were somehow lost still appears
 * in the record of what existed rather than vanishing from it.
 */
export async function readOptionMappingRows(
  executor: Executor,
  productId: string,
): Promise<OptionMappingRow[]> {
  return executor
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
    .leftJoin(
      productVariantOptionValues,
      eq(productVariantOptionValues.optionValueId, productOptionValues.id),
    )
    .where(eq(productOptions.productId, productId));
}

/** Every variant of the product, whether or not the mapping reached it. */
export async function readProductVariantIds(
  executor: Executor,
  productId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(eq(productVariants.productId, productId));

  return rows.map((row) => row.id);
}

/**
 * Removes the mapping and clears every variant's combination key.
 *
 * ## The delete order is not a preference
 *
 * `product_variant_option_values` references both `product_options` and
 * `product_option_values` with **`ON DELETE restrict`**, so the pairs must go
 * first or the option delete is refused. Deleting `product_options` then cascades
 * to `product_option_values` on its own. Same "every RESTRICT edge, innermost
 * first" ordering `purge-catalogue-products.mts` documents — and the wrong order
 * passes every test that never touches a real database, which is exactly how that
 * script was broken once.
 *
 * ## Clearing the key on every variant, not only the mapped ones
 *
 * A variant the mapping never reached already holds `null`, so the UPDATE is
 * idempotent for it. Scoping the UPDATE to mapped variants instead would leave a
 * stale key on any variant the mapping missed.
 *
 * A caller replacing the mapping in the same transaction (`remapOptionMapping`)
 * relies on this clearing happening *before* the new write, or the new
 * combination keys would be computed against rows that no longer exist.
 */
export async function deleteOptionMappingRows(
  executor: Executor,
  input: { optionIds: string[]; variantIds: string[]; now: Date },
): Promise<void> {
  if (input.variantIds.length > 0) {
    await executor
      .delete(productVariantOptionValues)
      .where(inArray(productVariantOptionValues.variantId, input.variantIds));
  }

  if (input.optionIds.length > 0) {
    await executor
      .delete(productOptions)
      .where(inArray(productOptions.id, input.optionIds));
  }

  if (input.variantIds.length > 0) {
    await executor
      .update(productVariants)
      .set({ optionCombinationKey: null, updatedAt: input.now })
      .where(inArray(productVariants.id, input.variantIds));
  }
}

/**
 * The mapping as it goes onto an audit event, and as `restoreOptionMapping` reads
 * it back.
 *
 * One entry per variant × option. Flat rather than nested on purpose: it is the
 * shape the query returns, so nothing is lost or reordered on the way into
 * `jsonb`, and a person reading the trail sees the same rows the database held.
 */
export type OptionMappingSnapshotEntry = {
  optionName: string;
  optionPosition: number;
  valueLabel: string | null;
  valueNormalized: string | null;
  valuePosition: number | null;
  variantId: string | null;
};

export function toMappingSnapshot(
  rows: OptionMappingRow[],
): OptionMappingSnapshotEntry[] {
  return rows.map((row) => ({
    optionName: row.optionName,
    optionPosition: row.optionPosition,
    valueLabel: row.valueLabel,
    valueNormalized: row.valueNormalized,
    valuePosition: row.valuePosition,
    variantId: row.variantId,
  }));
}
