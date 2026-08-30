import { and, eq } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import {
  productOptions,
  productVariants,
  products,
  providerVariantReferences,
} from '@/lib/db/schema';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import { normalizeOptionToken } from './identity';
import writeOptionMapping from './write-option-mapping';

/**
 * A Variant Matrix a person builds, for the labels no arithmetic can split.
 *
 * ## The case this exists for
 *
 * `deriveOptionSplit` recovers a grid from the supplier's own delimiter, and
 * `save-option-mapping.ts` writes it. Both refuse three real shapes: a ragged
 * token count (`Black-S` beside `Black-S-Cotton`), a duplicate label, and a
 * sparse grid too thin to compress. For those, the editor said the labels formed
 * no grid, offered nothing, and the storefront showed all 52 supplier strings
 * whole. `option-split.ts`'s own doc has promised since it was written that "the
 * seller must map it by hand" — that path did not exist. This is it.
 *
 * It also answers a case derivation can never reach, whether or not a grid
 * exists: **one token holding two attributes.** The live tactical pants encodes
 * colour and gender together and inconsistently — `Black Female`, `Black Men`,
 * `Female, Gray`, `Khaki Women` — so no split produces a `Colour` axis, however
 * clean the delimiter is. Only a person can say that `Black Female` means Black
 * and Women.
 *
 * ## Why the client may send structure here, when the derived path forbids it
 *
 * `save-option-mapping.ts` re-derives the structure and checks the payload
 * against it, so a crafted request cannot move a variant onto another
 * combination. That guarantee cannot hold here, because the structure *is* the
 * human decision — and it does not need to, for a reason worth being precise
 * about:
 *
 * - The derived path's rule protects against Sals3 **inventing** an attribute
 *   automatically and publishing it as fact. Nothing is invented here; a named
 *   person decided it, and `catalog_product.options_mapped_manually` records that
 *   it was this path, permanently distinguishable from the derived one.
 * - The write is tenant-scoped to a product the caller already owns and can
 *   already edit. A seller mislabelling their own goods is a product-data
 *   mistake they are entitled to make — they already type every display label —
 *   not a privilege they should not have.
 * - What must *not* be reachable is a **collision**: two variants ending on the
 *   same combination, so a buyer picks one and may be handed the other's price.
 *   That is refused below, **and the refusal below is the only thing refusing
 *   it** — see the warning under the collision check. There is no working
 *   database backstop.
 *
 * So this is deliberately available even where a split *is* derivable. Refusing
 * it there would have made the derived 2-axis reading of the tactical pants the
 * only one available, and the colour-and-gender token permanently unsplittable.
 *
 * ## Every variant, or none
 *
 * The assignment must cover exactly the variants the product has — no gaps, no
 * duplicates, no ids from elsewhere. The variant set comes from the database, not
 * from the payload. A partial mapping is the one shape that produces colliding
 * combination keys, and a mapping missing half the product is worse than none:
 * the storefront would offer axes that cannot reach most of the catalogue row.
 *
 * ## Insert-only, exactly as the derived path is
 *
 * Re-mapping is refused. Replacing a mapping means deleting option rows that
 * `product_variant_option_values` and `option_combination_key` both depend on,
 * and doing it safely needs an unmap path, a re-publish story, and a decision
 * about carts already holding a variant. None of that exists yet, so a mistake
 * here is corrected by renaming — which covers a wrong name or a wrong buyer
 * label, and does not cover a wrong assignment. That gap is real and is the next
 * thing this module needs.
 *
 * ## Costs nothing at the supplier
 *
 * Every input is already in the database or typed by the seller. No CJ call, no
 * points.
 */

export type ManualOptionMappingAxisInput = {
  /** Seller-typed, e.g. `Colour`. */
  name: string;
  /**
   * The values of this axis, in the order buyers should see them. Seller-typed:
   * unlike the derived path there is no supplier token to borrow, because the
   * whole reason this path exists is that no token corresponds to one axis.
   */
  values: string[];
};

export type ManualOptionMappingAssignmentInput = {
  variantId: string;
  /** One value per axis, in the submitted axis order. */
  values: string[];
};

export type SaveManualOptionMappingRefusal =
  | 'not_found'
  | 'version_conflict'
  | 'ALREADY_MAPPED'
  | 'NO_AXES'
  | 'EMPTY_NAME'
  | 'EMPTY_VALUE'
  | 'VALUE_COLLISION'
  | 'INCOMPLETE_ASSIGNMENT'
  | 'UNKNOWN_VARIANT'
  | 'UNKNOWN_VALUE'
  | 'COMBINATION_COLLISION';

export type SaveManualOptionMappingResult =
  | { ok: true; axisCount: number; mappedVariantCount: number }
  | { ok: false; reason: SaveManualOptionMappingRefusal; detail?: string };

function refuse(
  reason: SaveManualOptionMappingRefusal,
  detail?: string,
): SaveManualOptionMappingResult {
  return detail === undefined
    ? { ok: false, reason }
    : { ok: false, reason, detail };
}

/**
 * Everything checkable without touching the database, so a malformed payload
 * costs no queries and the transaction body stays about the product.
 */
export function validateManualMappingShape(
  axes: ManualOptionMappingAxisInput[],
  assignments: ManualOptionMappingAssignmentInput[],
): SaveManualOptionMappingResult | undefined {
  if (axes.length === 0) return refuse('NO_AXES');

  if (axes.some((axis) => axis.name.trim() === '')) {
    return refuse('EMPTY_NAME', 'Every option group needs a name.');
  }

  if (
    new Set(axes.map((axis) => normalizeOptionToken(axis.name))).size !==
    axes.length
  ) {
    return refuse(
      'VALUE_COLLISION',
      'Two option groups would end up with the same name.',
    );
  }

  const emptyValues = axes.find(
    (axis) =>
      axis.values.length === 0 ||
      axis.values.some((value) => value.trim() === ''),
  );

  if (emptyValues !== undefined) {
    return refuse(
      'EMPTY_VALUE',
      `"${emptyValues.name.trim()}" needs at least one value, and none may be blank.`,
    );
  }

  // Per axis, because `product_option_values_option_normalized_key` is scoped to
  // one option: `Black` may appear under Colour and under Trim.
  const collidingAxis = axes.find(
    (axis) =>
      new Set(axis.values.map((value) => normalizeOptionToken(value))).size !==
      axis.values.length,
  );

  if (collidingAxis !== undefined) {
    return refuse(
      'VALUE_COLLISION',
      `Two values in "${collidingAxis.name.trim()}" cannot be told apart.`,
    );
  }

  const wrongWidth = assignments.find(
    (assignment) => assignment.values.length !== axes.length,
  );

  if (wrongWidth !== undefined) {
    return refuse(
      'INCOMPLETE_ASSIGNMENT',
      'Every variant needs one value from every option group.',
    );
  }

  const unknownValue = assignments.find((assignment) =>
    assignment.values.some((value, axisIndex) => {
      const axis = axes[axisIndex];

      if (axis === undefined) return true;

      return !axis.values.some(
        (candidate) =>
          normalizeOptionToken(candidate) === normalizeOptionToken(value),
      );
    }),
  );

  if (unknownValue !== undefined) {
    return refuse(
      'UNKNOWN_VALUE',
      'A variant was assigned a value that is not in its option group.',
    );
  }

  return undefined;
}

export default async function saveManualOptionMapping(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  expectedProductVersion: number;
  axes: ManualOptionMappingAxisInput[];
  assignments: ManualOptionMappingAssignmentInput[];
  db?: Database;
}): Promise<SaveManualOptionMappingResult> {
  const db = input.db ?? getDb();
  const now = new Date();

  const shapeRefusal = validateManualMappingShape(
    input.axes,
    input.assignments,
  );

  if (shapeRefusal !== undefined) return shapeRefusal;

  return db.transaction(async (tx): Promise<SaveManualOptionMappingResult> => {
    // Tenant scope and compare-and-set in one predicate, as every other write
    // path in this module family does: not found, not yours, and version-moved
    // all answer alike.
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

    if (product === undefined) return refuse('not_found');
    if (product.version !== input.expectedProductVersion) {
      return refuse('version_conflict');
    }

    const existing = await tx
      .select({ id: productOptions.id })
      .from(productOptions)
      .where(eq(productOptions.productId, input.productId))
      .limit(1);

    if (existing.length > 0) return refuse('ALREADY_MAPPED');

    // The variant set is the database's, never the payload's. Mirrors
    // `loadVariantLabels` in the derived path so the two cannot disagree about
    // which variants a product has.
    const variantRows = await tx
      .select({
        variantId: productVariants.id,
        label: providerVariantReferences.sourceOptionLabel,
      })
      .from(productVariants)
      .leftJoin(
        providerVariantReferences,
        eq(providerVariantReferences.variantId, productVariants.id),
      )
      .where(eq(productVariants.productId, input.productId));

    const realVariantIds = new Set(variantRows.map((row) => row.variantId));
    const submittedIds = input.assignments.map(
      (assignment) => assignment.variantId,
    );
    const uniqueSubmitted = new Set(submittedIds);

    if (uniqueSubmitted.size !== submittedIds.length) {
      return refuse(
        'UNKNOWN_VARIANT',
        'The same variant was assigned more than once.',
      );
    }

    const foreign = submittedIds.find((id) => !realVariantIds.has(id));

    if (foreign !== undefined) {
      return refuse(
        'UNKNOWN_VARIANT',
        'An assignment named a variant this product does not have.',
      );
    }

    if (uniqueSubmitted.size !== realVariantIds.size) {
      return refuse(
        'INCOMPLETE_ASSIGNMENT',
        `${realVariantIds.size - uniqueSubmitted.size} of this product's ${realVariantIds.size} variants have no option values yet.`,
      );
    }

    /**
     * The check the buyer is actually protected by, and it is on its own.
     *
     * Two variants on one combination means a selection can be honoured by
     * either. `buildOptionCombinationKey` sorts its pairs, so comparing the
     * normalized values in axis order is the same comparison the stored key
     * makes.
     *
     * > [!WARNING] The database index everyone reaches for here does not fire.
     * > `product_variants_active_combination_key` is unique on
     * > `(product_id, option_combination_key)` **`WHERE status = 'ACTIVE'`**, and
     * > nothing in this codebase ever sets a variant to `ACTIVE` —
     * > `insertDraftVariant` writes `DRAFT` and there is no other writer, which
     * > is also why `product_variants_active_requires_combination` never fires.
     * > So the partial index covers zero rows and is inert. It was cited as the
     * > backstop under this check in three places before anyone checked whether
     * > it applies. Treat this comparison as the whole guard until a writer for
     * > `ACTIVE` exists.
     */
    const combinationKeys = input.assignments.map((assignment) =>
      assignment.values.map((value) => normalizeOptionToken(value)).join(' '),
    );

    if (new Set(combinationKeys).size !== combinationKeys.length) {
      return refuse(
        'COMBINATION_COLLISION',
        'Two variants were given the same combination of values, so a buyer could not tell them apart.',
      );
    }

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

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      /**
       * Deliberately not `catalog_product.options_mapped`.
       *
       * The two paths carry different warrants — one is checked against the
       * supplier's own labels, one is a person's judgement — and a dispute about
       * what a buyer was shown has to be able to tell them apart years later.
       * One action name for both would erase that distinction permanently.
       */
      action: 'catalog_product.options_mapped_manually',
      entityType: 'product',
      entityId: input.productId,
      payload: {
        axisCount: written.axisCount,
        mappedVariantCount: written.mappedVariantCount,
        axisNames: input.axes.map((axis) => axis.name.trim()),
        // The supplier's own strings at the moment a person reinterpreted them.
        // A later CJ label change leaves the assignment untouched — it is keyed
        // on `variant_id` — so this is the only record of what was being read.
        supplierLabels: variantRows.map((row) => row.label),
      },
    });

    return {
      ok: true,
      axisCount: written.axisCount,
      mappedVariantCount: written.mappedVariantCount,
    };
  });
}
