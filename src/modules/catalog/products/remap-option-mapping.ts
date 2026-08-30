import { and, eq } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import { products } from '@/lib/db/schema';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import { normalizeOptionToken } from './identity';
import {
  deleteOptionMappingRows,
  readOptionMappingRows,
  readProductVariantIds,
  toMappingSnapshot,
} from './option-mapping-rows';
import {
  validateAssignmentsAgainstVariants,
  validateManualMappingShape,
  type ManualOptionMappingAssignmentInput,
  type ManualOptionMappingAxisInput,
} from './save-manual-option-mapping';
import writeOptionMapping from './write-option-mapping';

/**
 * Replacing a saved Variant Matrix in one transaction.
 *
 * ## Why this exists when unmap and map already do
 *
 * They do, in sequence, and the sequence is the problem. Removing then rebuilding
 * leaves a window — minutes at 52 variants — in which:
 *
 * - the live PDP has degraded to the supplier's own concatenated labels;
 * - `OPTIONS_UNMAPPED` blocks publishing anything else about the product;
 * - a crash, a closed tab or a lost session leaves the product unmapped with the
 *   old mapping recoverable only from an audit event.
 *
 * None of that is a risk anybody chose. It is the shape of doing two writes where
 * one was meant, so this is the one write: the deletes and the new inserts commit
 * together or neither does. A buyer loading the page mid-replace sees the old
 * mapping or the new one, never raw labels.
 *
 * ## What it does not loosen
 *
 * Every guard the by-hand save applies, applies here — the shape check, the
 * variant set coming from the database rather than the payload, full coverage, and
 * the collision refusal — through the *same* two functions rather than a second
 * copy of them. What differs is one condition, inverted: `saveManualOptionMapping`
 * refuses a product that already has a mapping, and this one refuses a product
 * that does not.
 *
 * ## The old mapping still goes onto an audit event
 *
 * Even though nothing is lost to a gap here, the previous mapping is snapshotted
 * exactly as unmap snapshots it. A replacement destroys the buyer-facing labels a
 * person typed just as thoroughly as a removal, `product_options` has no history
 * table, and `catalog_product.options_remapped` carrying both sides is what lets a
 * later dispute see what a buyer read before and after.
 *
 * ## Costs nothing at the supplier
 *
 * Every input is already in the database or typed by the seller. No CJ call, no
 * points (ADR-017).
 */

export type RemapOptionMappingRefusal =
  | 'not_found'
  | 'version_conflict'
  | 'NOT_MAPPED'
  | 'NO_AXES'
  | 'EMPTY_NAME'
  | 'EMPTY_VALUE'
  | 'VALUE_COLLISION'
  | 'INCOMPLETE_ASSIGNMENT'
  | 'UNKNOWN_VARIANT'
  | 'UNKNOWN_VALUE'
  | 'COMBINATION_COLLISION';

export type RemapOptionMappingResult =
  | {
      ok: true;
      axisCount: number;
      mappedVariantCount: number;
      replacedAxisCount: number;
    }
  | { ok: false; reason: RemapOptionMappingRefusal; detail?: string };

export default async function remapOptionMapping(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  expectedProductVersion: number;
  axes: ManualOptionMappingAxisInput[];
  assignments: ManualOptionMappingAssignmentInput[];
  /** Recorded on the audit event. Absent when the seller gave no wording. */
  reason?: string | null;
  db?: Database;
}): Promise<RemapOptionMappingResult> {
  const db = input.db ?? getDb();
  const now = new Date();

  // Shared with the by-hand save, so a malformed payload costs no queries on
  // either path and the two cannot disagree about what "malformed" means.
  const shapeRefusal = validateManualMappingShape(
    input.axes,
    input.assignments,
  );

  if (shapeRefusal !== undefined) {
    return shapeRefusal as RemapOptionMappingResult;
  }

  return db.transaction(async (tx): Promise<RemapOptionMappingResult> => {
    // Tenant scope and compare-and-set in one predicate, as every other write
    // path in this family does.
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

    const previous = await readOptionMappingRows(tx, input.productId);

    /**
     * The inverted condition, and the only one.
     *
     * A product with no mapping is a *first* mapping, which
     * `saveManualOptionMapping` owns. Letting this path write it too would give
     * one outcome two implementations and two audit actions, so the answer here
     * is a refusal rather than a silent fall-through.
     */
    if (previous.length === 0) return { ok: false, reason: 'NOT_MAPPED' };

    const variantIds = await readProductVariantIds(tx, input.productId);
    const assignmentRefusal = validateAssignmentsAgainstVariants(
      input.assignments,
      variantIds,
    );

    if (assignmentRefusal !== undefined) {
      return assignmentRefusal as RemapOptionMappingResult;
    }

    // Order matters inside the transaction too: the deletes clear every
    // combination key, and the write below recomputes them. Writing first would
    // collide with rows about to be removed.
    await deleteOptionMappingRows(tx, {
      optionIds: [...new Set(previous.map((row) => row.optionId))],
      variantIds,
      now,
    });

    const written = await writeOptionMapping(
      tx,
      {
        productId: input.productId,
        axes: input.axes.map((axis) => ({
          name: axis.name.trim(),
          values: axis.values.map((value) => ({
            normalizedValue: normalizeOptionToken(value),
            label: value.trim(),
          })),
        })),
        assignments: input.assignments.map((assignment) => ({
          variantId: assignment.variantId,
          normalizedValues: assignment.values.map((value) =>
            normalizeOptionToken(value),
          ),
        })),
      },
      now,
    );

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

    const replacedAxisCount = new Set(previous.map((row) => row.optionId)).size;

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      /**
       * Its own action, like the two mapping paths have theirs.
       *
       * A replacement is neither a first mapping nor a removal, and a dispute
       * about what a buyer read has to be able to tell all three apart years
       * later. One name shared with `options_mapped_manually` would lose the fact
       * that something was overwritten.
       */
      action: 'catalog_product.options_remapped',
      entityType: 'product',
      entityId: input.productId,
      payload: {
        axisCount: written.axisCount,
        mappedVariantCount: written.mappedVariantCount,
        replacedAxisCount,
        axisNames: input.axes.map((axis) => axis.name.trim()),
        reason: input.reason ?? null,
        // Both sides. `replaced` is the same shape `options_unmapped` writes, so
        // `restoreOptionMapping` can read either event.
        replaced: toMappingSnapshot(previous),
      },
    });

    return {
      ok: true,
      axisCount: written.axisCount,
      mappedVariantCount: written.mappedVariantCount,
      replacedAxisCount,
    };
  });
}
