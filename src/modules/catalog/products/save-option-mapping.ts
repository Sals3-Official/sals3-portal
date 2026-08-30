import { and, eq } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import {
  productOptions,
  productVariants,
  products,
  providerVariantReferences,
} from '@/lib/db/schema';
import {
  appendAuditEvent,
  type Executor,
} from '@/modules/catalog/candidates/repository';
import { normalizeOptionToken } from './identity';
import { deriveOptionSplit, splitLabelTokens } from './option-split';
import writeOptionMapping from './write-option-mapping';

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
  | 'SHAPE_MISMATCH'
  /**
   * Two names or two values that a unique index cannot tell apart once
   * normalized. Previously this aborted the transaction with no seller-facing
   * reason at all — see the check in the writes section.
   */
  | 'VALUE_COLLISION';

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
    // Normalization has to be injective before anything is inserted.
    //
    // `product_option_values_option_normalized_key` is unique on
    // (option, normalized_value), so two distinct supplier tokens that normalize
    // to one string — `Black` beside `black` — abort the transaction on the
    // second insert. That was always true and reached nobody as an explanation:
    // the seller saw a failed save with no reason. The same applies to axis
    // names through `product_options_product_normalized_name_key`.
    const axisNameCollision =
      new Set(input.axes.map((axis) => normalizeOptionToken(axis.name)))
        .size !== input.axes.length;

    if (axisNameCollision) {
      return {
        ok: false,
        reason: 'VALUE_COLLISION',
        detail: 'Two option groups would end up with the same name.',
      };
    }

    const collidingAxis = input.axes.find(
      (axis) =>
        new Set(axis.values.map((value) => normalizeOptionToken(value.raw)))
          .size !== axis.values.length,
    );

    if (collidingAxis !== undefined) {
      return {
        ok: false,
        reason: 'VALUE_COLLISION',
        detail: `Two supplier values in "${collidingAxis.name.trim()}" cannot be told apart once normalized.`,
      };
    }

    /**
     * Which value each variant takes on each axis, read off the supplier's own
     * tokens.
     *
     * `position.index` is the token's place in the SUPPLIER's label, which is not
     * the axis's place in `plan.axes` once `deriveOptionSplit` has dropped a
     * constant position: a product whose colour never varies has one axis, and it
     * sits at label position 1. Reading the token by array index instead mapped
     * every variant to zero pairs the first time this ran against such a product
     * — nothing threw, and the mapping "succeeded" with every variant unmapped.
     */
    const assignments = variants.flatMap((variant) => {
      const tokens = splitLabelTokens(variant.label ?? '');
      const normalizedValues = split.positions.map((position) =>
        normalizeOptionToken(tokens[position.index] ?? ''),
      );

      // A variant missing a token at any surviving position cannot be placed on
      // the grid. Shape validation above makes this unreachable; it stays because
      // a partial assignment is the one shape that can collide with another.
      if (normalizedValues.some((value) => value === '')) return [];

      return [{ variantId: variant.variantId, normalizedValues }];
    });

    const written = await writeOptionMapping(
      tx,
      {
        productId: input.productId,
        axes: input.axes.map((axis) => ({
          name: axis.name.trim(),
          values: axis.values.map((value) => ({
            // Normalized from the SUPPLIER token, never the display label: it is
            // the join key, and the seller may rename the label freely without
            // silently repointing a variant at another variant's price.
            normalizedValue: normalizeOptionToken(value.raw),
            label: value.label.trim(),
          })),
        })),
        assignments,
      },
      now,
    );
    const { mappedVariantCount } = written;

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
