import { and, eq } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import {
  productOptionValues,
  productOptions,
  productVariantOptionValues,
  productVariants,
  products,
  providerVariantReferences,
} from '@/lib/db/schema';
import {
  appendAuditEvent,
  type Executor,
} from '@/modules/catalog/candidates/repository';
import { buildOptionCombinationKey, normalizeOptionToken } from './identity';
import deriveOptionSplit, { splitLabelTokens } from './option-split';

/**
 * Persisting a seller's option mapping — the first writer these three tables
 * have ever had.
 *
 * `product_options`, `product_option_values` and `product_variant_option_values`
 * have existed since the canonical catalogue migration with **zero inserts**
 * anywhere in the codebase, which is why every product's variants reach the
 * storefront as one opaque string and `buildOptionCombinationKey` was written
 * and never called.
 *
 * ## The client sends names, never structure
 *
 * The payload carries only what a person decided: the axis names, and a display
 * label per supplier token. **The structure is re-derived here** from
 * `provider_variant_references.source_option_label`, and the submitted shape is
 * checked against it. A crafted payload therefore cannot reassign a variant to a
 * different combination — the worst it can do is fail validation. That matters
 * because a wrong assignment would hand a buyer one variant's price and another
 * variant's goods.
 *
 * ## Insert-only, deliberately
 *
 * Re-mapping is refused rather than implemented. Replacing a mapping means
 * deleting option rows that `product_variant_option_values` and
 * `option_combination_key` both depend on, and doing that safely needs its own
 * design — an unmap path, a re-publish story, and a decision about carts already
 * holding a variant. Refusing is honest until that exists.
 *
 * ## Costs nothing at the supplier
 *
 * Every input is already in the database. No CJ call, no points.
 */

export type OptionMappingAxisInput = {
  /** Seller-typed, e.g. "Colour". Never inferred from the supplier string. */
  name: string;
  values: {
    /** The supplier's own token — the join key, never edited by the seller. */
    raw: string;
    /** What a buyer sees. Defaults to `raw` in the UI, editable. */
    label: string;
  }[];
};

export type SaveOptionMappingRefusal =
  | 'not_found'
  | 'version_conflict'
  | 'ALREADY_MAPPED'
  | 'SPLIT_NOT_DERIVABLE'
  | 'SHAPE_MISMATCH';

export type SaveOptionMappingResult =
  | { ok: true; axisCount: number; mappedVariantCount: number }
  | { ok: false; reason: SaveOptionMappingRefusal; detail?: string };

type VariantLabelRow = { variantId: string; label: string | null };

async function loadVariantLabels(
  executor: Executor,
  productId: string,
): Promise<VariantLabelRow[]> {
  const rows = await executor
    .select({
      variantId: productVariants.id,
      label: providerVariantReferences.sourceOptionLabel,
    })
    .from(productVariants)
    // Unique on `variant_id`, so this matches at most one row per variant.
    .leftJoin(
      providerVariantReferences,
      eq(providerVariantReferences.variantId, productVariants.id),
    )
    .where(eq(productVariants.productId, productId));

  return rows;
}

/** Same values, order-insensitive — the seller may sort a row however they like. */
function sameValueSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;

  const seen = new Set(right);

  return left.every((value) => seen.has(value));
}

export default async function saveOptionMapping(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  expectedProductVersion: number;
  axes: OptionMappingAxisInput[];
  db?: Database;
}): Promise<SaveOptionMappingResult> {
  const db = input.db ?? getDb();
  const now = new Date();

  return db.transaction(async (tx): Promise<SaveOptionMappingResult> => {
    // Tenant scope and compare-and-set in one predicate, as every other write
    // path here does: not found, not yours, and version-moved answer alike.
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

    const existing = await tx
      .select({ id: productOptions.id })
      .from(productOptions)
      .where(eq(productOptions.productId, input.productId))
      .limit(1);

    if (existing.length > 0) return { ok: false, reason: 'ALREADY_MAPPED' };

    const variants = await loadVariantLabels(tx, input.productId);
    const split = deriveOptionSplit(variants);

    if (split === undefined) {
      return {
        ok: false,
        reason: 'SPLIT_NOT_DERIVABLE',
        detail:
          'The supplier labels on this product do not form a complete grid, so a mapping cannot be checked against them.',
      };
    }

    // The submitted shape must match what the labels actually encode. This is
    // what stops a payload from inventing an axis or moving a value between them.
    if (input.axes.length !== split.positions.length) {
      return {
        ok: false,
        reason: 'SHAPE_MISMATCH',
        detail: `Expected ${split.positions.length} option groups, received ${input.axes.length}.`,
      };
    }

    const shapeMatches = split.positions.every((position, index) => {
      const axis = input.axes[index];

      if (axis === undefined) return false;

      return sameValueSet(
        axis.values.map((value) => value.raw),
        position.values,
      );
    });

    if (!shapeMatches) {
      return {
        ok: false,
        reason: 'SHAPE_MISMATCH',
        detail:
          'The submitted option values do not match the supplier labels on this product.',
      };
    }

    // ---- writes ----------------------------------------------------------
    const valueIdByPositionAndRaw = new Map<string, string>();

    // Ordered, not parallel: `product_options_product_position_key` is unique on
    // (product, position), so the rows must land one at a time in a known order.
    // eslint-disable-next-line no-restricted-syntax
    for (const [index, axis] of input.axes.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const [option] = await tx
        .insert(productOptions)
        .values({
          productId: input.productId,
          name: axis.name.trim(),
          normalizedName: normalizeOptionToken(axis.name),
          position: index,
        })
        .returning({ id: productOptions.id });

      // An insert-returning that yields no row is a broken invariant, not a case
      // to skip past: skipping would leave the values orphaned and the variants
      // half-mapped. Throwing rolls the whole transaction back.
      if (option === undefined) {
        throw new Error(`Option insert returned no row for "${axis.name}".`);
      }

      // eslint-disable-next-line no-restricted-syntax
      for (const [valueIndex, value] of axis.values.entries()) {
        // eslint-disable-next-line no-await-in-loop
        const [stored] = await tx
          .insert(productOptionValues)
          .values({
            optionId: option.id,
            label: value.label.trim(),
            // Normalized from the SUPPLIER token, not the display label: it is
            // the join key, and the seller may rename the label freely without
            // silently repointing a variant.
            normalizedValue: normalizeOptionToken(value.raw),
            position: valueIndex,
          })
          .returning({ id: productOptionValues.id });

        if (stored !== undefined) {
          valueIdByPositionAndRaw.set(`${index}\u0000${value.raw}`, stored.id);
        }
      }

      valueIdByPositionAndRaw.set(`option\u0000${index}`, option.id);
    }

    let mappedVariantCount = 0;

    // eslint-disable-next-line no-restricted-syntax
    for (const variant of variants) {
      const tokens = splitLabelTokens(variant.label ?? '');
      const pairs: { optionId: string; normalizedValue: string }[] = [];

      // eslint-disable-next-line no-restricted-syntax
      for (const [index, token] of tokens.entries()) {
        const optionId = valueIdByPositionAndRaw.get(`option\u0000${index}`);
        const valueId = valueIdByPositionAndRaw.get(`${index}\u0000${token}`);

        if (optionId !== undefined && valueId !== undefined) {
          // eslint-disable-next-line no-await-in-loop
          await tx.insert(productVariantOptionValues).values({
            variantId: variant.variantId,
            optionId,
            optionValueId: valueId,
          });

          pairs.push({
            optionId,
            normalizedValue: normalizeOptionToken(token),
          });
        }
      }

      const combinationKey = buildOptionCombinationKey(pairs);

      // `null` means this variant produced no pairs at all, so it stays unmapped
      // rather than being given a combination key it did not earn. The check
      // constraint depends on exactly that: no key, never `ACTIVE`.
      if (combinationKey !== null) {
        // eslint-disable-next-line no-await-in-loop
        await tx
          .update(productVariants)
          .set({ optionCombinationKey: combinationKey, updatedAt: now })
          .where(eq(productVariants.id, variant.variantId));

        mappedVariantCount += 1;
      }
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
      action: 'catalog_product.options_mapped',
      entityType: 'product',
      entityId: input.productId,
      payload: {
        axisCount: input.axes.length,
        mappedVariantCount,
        // Names are the seller's decision and worth recording; supplier tokens
        // are already on the variant references.
        axisNames: input.axes.map((axis) => axis.name.trim()),
        combinationCount: split.byCombination.size,
      },
    });

    return { ok: true, axisCount: input.axes.length, mappedVariantCount };
  });
}
