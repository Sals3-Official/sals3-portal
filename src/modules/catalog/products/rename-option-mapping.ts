import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import { productOptionValues, productOptions, products } from '@/lib/db/schema';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import { PRODUCT_AUDIT_ACTIONS } from './contracts';

/**
 * Renaming an existing Variant Matrix — the buyer-facing words only.
 *
 * `saveOptionMapping` is insert-only and refuses `ALREADY_MAPPED`, for good
 * reasons that all concern *structure*: replacing a mapping means deleting
 * option rows that `product_variant_option_values` and
 * `option_combination_key` depend on, which needs an unmap path and a story
 * for carts and accepted orders already holding a variant.
 *
 * None of that applies to the words. `option_combination_key` is built from
 * the supplier's own token (`normalizeOptionToken`), never from the buyer
 * label, and `product_option_values.normalized_value` — the column the
 * uniqueness index and every variant link use — is untouched here. So an
 * axis called `Colr` can become `Colour`, and a value shown as `Army Green`
 * can become `Olive`, with no row deleted, no key recomputed, no variant
 * identity moved, and nothing to reconcile against an order.
 *
 * ## Order travels with the words
 *
 * The order values appear in is presentation, exactly like the label. `S, M, L,
 * XL, XXL` is recoverable by no algorithm — the supplier sends one token per
 * variant and nothing that ranks them — so a seller who cannot reorder is left
 * with whatever first-seen order the split produced, which on this product read
 * `L, M, S, XL, XXL`. Nothing joins on `position`:
 * `product_variant_option_values` links by value id and
 * `option_combination_key` is built from `normalized_value`, so moving a row
 * changes what a buyer reads and nothing a cart or an accepted order holds.
 *
 * `values` arrives in the order the seller arranged, and the array index *is*
 * the stored position. There is no separate order field to disagree with it.
 *
 * What this deliberately cannot do: add or remove an axis, change which
 * supplier token sits at which position, or re-split a product. Those are
 * the structural changes, and they remain refused until they have their own
 * design. Axis order (`product_options.position`) is likewise untouched — that
 * is which option comes first, which the matrix's own identity is built on.
 */

export type RenameOptionMappingAxisInput = {
  optionId: string;
  name: string;
  values: { valueId: string; label: string }[];
};

export type RenameOptionMappingRefusal =
  | 'not_found'
  | 'version_conflict'
  | 'NOT_MAPPED'
  | 'UNKNOWN_AXIS'
  | 'DUPLICATE_AXIS_NAME';

export type RenameOptionMappingResult =
  | {
      ok: true;
      axisCount: number;
      renamedValueCount: number;
      /** Axes whose value order the seller actually changed. */
      reorderedAxisCount: number;
    }
  | { ok: false; reason: RenameOptionMappingRefusal; detail?: string };

function hasDuplicate(values: string[]): boolean {
  const seen = new Set(values.map((value) => value.trim().toLowerCase()));

  return seen.size !== values.length;
}

export default async function renameOptionMapping(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  expectedProductVersion: number;
  axes: RenameOptionMappingAxisInput[];
  db?: Database;
}): Promise<RenameOptionMappingResult> {
  const db = input.db ?? getDb();
  const now = new Date();

  return db.transaction(async (tx): Promise<RenameOptionMappingResult> => {
    // Tenant scope and compare-and-set in one predicate, same shape as every
    // other write path here.
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

    const storedOptions = await tx
      .select({ id: productOptions.id })
      .from(productOptions)
      .where(eq(productOptions.productId, input.productId));

    if (storedOptions.length === 0) {
      return { ok: false, reason: 'NOT_MAPPED' };
    }

    // Every axis in the request must be one of this product's own, and every
    // one of this product's own must be in the request. A partial rename
    // would leave the matrix half in the old vocabulary.
    const storedIds = new Set(storedOptions.map((option) => option.id));

    if (
      input.axes.length !== storedOptions.length ||
      input.axes.some((axis) => !storedIds.has(axis.optionId))
    ) {
      return { ok: false, reason: 'UNKNOWN_AXIS' };
    }

    if (hasDuplicate(input.axes.map((axis) => axis.name))) {
      return { ok: false, reason: 'DUPLICATE_AXIS_NAME' };
    }

    const storedValues = await tx
      .select({
        id: productOptionValues.id,
        optionId: productOptionValues.optionId,
        position: productOptionValues.position,
      })
      .from(productOptionValues)
      .where(
        inArray(
          productOptionValues.optionId,
          storedOptions.map((option) => option.id),
        ),
      );

    const valueOwner = new Map(
      storedValues.map((value) => [value.id, value.optionId]),
    );

    // A value id belonging to another axis — or another product — would move
    // a label onto goods it does not describe.
    const misplaced = input.axes.some((axis) =>
      axis.values.some(
        (value) => valueOwner.get(value.valueId) !== axis.optionId,
      ),
    );

    if (misplaced) return { ok: false, reason: 'UNKNOWN_AXIS' };

    /**
     * Every value of every axis must be present, because the array index is
     * now the stored position.
     *
     * A request missing one value used to be harmless — it simply went
     * unrenamed. It is not harmless once order is written: the omitted row
     * would keep the temporary offset position assigned below and sort after
     * everything, so a partial payload would silently push a size to the end
     * of the list. Refused as `UNKNOWN_AXIS`, whose seller-facing sentence
     * already says the submitted options no longer match the saved matrix and
     * to reload.
     */
    const storedCountByAxis = new Map<string, number>();

    storedValues.forEach((value) => {
      storedCountByAxis.set(
        value.optionId,
        (storedCountByAxis.get(value.optionId) ?? 0) + 1,
      );
    });

    const incomplete = input.axes.some(
      (axis) =>
        axis.values.length !== (storedCountByAxis.get(axis.optionId) ?? 0) ||
        new Set(axis.values.map((value) => value.valueId)).size !==
          axis.values.length,
    );

    if (incomplete) return { ok: false, reason: 'UNKNOWN_AXIS' };

    /**
     * Positions are written in two passes, and the offset is why.
     *
     * `product_option_values_option_position_key` is a plain unique index, so
     * it is checked per row as the statement runs and cannot be deferred; a
     * straight swap of two rows collides on the first write. Moving every row
     * of an axis above its own current maximum first empties the whole
     * `0..n-1` range, so the second pass can assign final positions in any
     * order. Negative sentinels would be simpler and are not available:
     * `product_option_values_position_non_negative` forbids them.
     */
    const positionOffset =
      Math.max(0, ...storedValues.map((value) => value.position)) + 1;

    // Recorded in the audit event: "renamed" and "reordered" are different
    // seller intents, and a history that cannot tell them apart cannot answer
    // why a size list changed order.
    const storedPosition = new Map(
      storedValues.map((value) => [value.id, value.position]),
    );
    const reorderedAxisCount = input.axes.filter((axis) =>
      axis.values.some(
        (value, index) => storedPosition.get(value.valueId) !== index,
      ),
    ).length;

    let renamedValueCount = 0;

    // eslint-disable-next-line no-restricted-syntax -- sequential: small, bounded by axis count, and inside one transaction.
    for (const axis of input.axes) {
      // eslint-disable-next-line no-await-in-loop
      await tx
        .update(productOptions)
        .set({ name: axis.name.trim() })
        .where(eq(productOptions.id, axis.optionId));

      // Clear the `0..n-1` range before any final position is written — see
      // the offset note above.
      // eslint-disable-next-line no-await-in-loop
      await tx
        .update(productOptionValues)
        .set({
          position: sql`${productOptionValues.position} + ${positionOffset}`,
        })
        .where(eq(productOptionValues.optionId, axis.optionId));

      // eslint-disable-next-line no-restricted-syntax
      for (const [index, value] of axis.values.entries()) {
        // `label` and `position` only. `normalized_value` is the supplier's
        // own token and the join key every variant link and the uniqueness
        // index use — it is what makes this rename safe, and it must never be
        // written here.
        // eslint-disable-next-line no-await-in-loop
        await tx
          .update(productOptionValues)
          .set({ label: value.label.trim(), position: index })
          .where(eq(productOptionValues.id, value.valueId));

        renamedValueCount += 1;
      }
    }

    await tx
      .update(products)
      .set({ version: product.version + 1, updatedAt: now })
      .where(eq(products.id, product.id));

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: PRODUCT_AUDIT_ACTIONS.optionMappingRenamed,
      entityType: 'Product',
      entityId: product.id,
      payload: {
        sellerAccountId: input.sellerAccountId,
        axisNames: input.axes.map((axis) => axis.name.trim()),
        renamedValueCount,
        reorderedAxisCount,
      },
    });

    return {
      ok: true,
      axisCount: input.axes.length,
      renamedValueCount,
      reorderedAxisCount,
    };
  });
}
