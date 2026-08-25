import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  ACTIVE_ATTRIBUTE_CONTROLS_VERSION,
  categoryAttributeControls,
} from '@/lib/db/schema/category-attribute-controls';
import { sals3Categories } from '@/lib/db/schema/pricing-policy';

import {
  NARROWED_CONTROL_VALUES,
  REMOVED_CONTROLS,
} from './attribute-control-corrections';

/**
 * Applies the recorded corrections to controls a deployed database already
 * holds.
 *
 * ## Why a separate path exists at all
 *
 * `seedAttributeControlsData` is **additive only** — every insert carries
 * `onConflictDoNothing` — so it can create a control row and can never remove
 * or change one. Taking `Neckline` off a skirt in the extract therefore does
 * nothing to an environment that has already been seeded: the row is there, and
 * only a statement that names it will take it away.
 *
 * ## No `controlsVersion` bump, deliberately
 *
 * The alternative was seeding a `v2` of all 53,625 rows and moving
 * `ACTIVE_ATTRIBUTE_CONTROLS_VERSION` onto it. That constant lives in code
 * (`schema/category-attribute-controls.ts`), and every read joins on it — the
 * storefront's specification projection and the editor's contract both — so the
 * data and the deploy would have to land in a strict order, and any window
 * where the code names a version the database has not finished seeding is a
 * window where **every** product's specifications disappear. Eight wrong rows
 * do not justify that exposure. This corrects them in place, inside the version
 * already in force.
 *
 * ## What removing a control does to values already stored
 *
 * Nothing has to be backfilled. The storefront's specification query
 * `innerJoin`s `category_attribute_controls` on
 * `(categoryId, attributeName, controlsVersion)`, so a value whose control is
 * gone stops matching and stops rendering; the editor builds its fields from
 * the same controls. The rows in `product_category_attribute_values` are left
 * where they are — orphaned but harmless, and still there if the decision is
 * ever reversed. Deleting a seller's stored answer is not this job.
 *
 * Narrowing an allow list strands nobody either: `Dress / Skirt Style` carries
 * `allowCustomValue: true`, so a live skirt already recorded as `Maxi Dress` is
 * still accepted as a custom value rather than refused. It just stops being
 * offered to the next seller.
 *
 * ## Idempotent
 *
 * The delete matches nothing on a second run, and each update writes the values
 * the row already holds. Safe to call repeatedly, which a break-glass endpoint
 * has to be.
 */
export type CorrectAttributeControlsResult = {
  /** Control rows removed, of the eight this correction names. */
  controlsRemoved: number;
  /** Rows whose allowed values were rewritten. */
  allowedValuesRewritten: number;
  /**
   * Category codes named by the correction that no database row matched.
   *
   * Reported rather than thrown: an environment seeded from a different
   * taxonomy version legitimately has none of them, and that is worth seeing
   * rather than worth failing over.
   */
  unmatchedCategoryCodes: string[];
};

export async function correctAttributeControls(
  db: Database,
): Promise<CorrectAttributeControlsResult> {
  const codes = [
    ...new Set([
      ...REMOVED_CONTROLS.map((entry) => entry.categoryCode),
      ...NARROWED_CONTROL_VALUES.map((entry) => entry.categoryCode),
    ]),
  ];

  const categories = await db
    .select({ id: sals3Categories.id, code: sals3Categories.code })
    .from(sals3Categories)
    .where(inArray(sals3Categories.code, codes));

  const categoryIdByCode = new Map(
    categories.map((row) => [row.code, row.id] as const),
  );
  const unmatchedCategoryCodes = codes.filter(
    (code) => !categoryIdByCode.has(code),
  );

  /**
   * Run as array iterations rather than sequential loops: each statement names
   * one row and none depends on another's outcome, so ordering them would be a
   * claim about this work that is not true.
   */
  const removals = REMOVED_CONTROLS.flatMap((entry) => {
    const categoryId = categoryIdByCode.get(entry.categoryCode);

    return categoryId === undefined ? [] : [{ ...entry, categoryId }];
  });

  const rewrites = NARROWED_CONTROL_VALUES.flatMap((entry) => {
    const categoryId = categoryIdByCode.get(entry.categoryCode);

    return categoryId === undefined ? [] : [{ ...entry, categoryId }];
  });

  const removedRows = await Promise.all(
    removals.map((entry) =>
      db
        .delete(categoryAttributeControls)
        .where(
          and(
            eq(categoryAttributeControls.categoryId, entry.categoryId),
            eq(categoryAttributeControls.attributeName, entry.attributeName),
            eq(
              categoryAttributeControls.controlsVersion,
              ACTIVE_ATTRIBUTE_CONTROLS_VERSION,
            ),
          ),
        )
        .returning({ id: categoryAttributeControls.id }),
    ),
  );

  const rewrittenRows = await Promise.all(
    rewrites.map((entry) =>
      db
        .update(categoryAttributeControls)
        .set({ allowedValues: entry.allowedValues })
        .where(
          and(
            eq(categoryAttributeControls.categoryId, entry.categoryId),
            eq(categoryAttributeControls.attributeName, entry.attributeName),
            eq(
              categoryAttributeControls.controlsVersion,
              ACTIVE_ATTRIBUTE_CONTROLS_VERSION,
            ),
          ),
        )
        .returning({ id: categoryAttributeControls.id }),
    ),
  );

  const controlsRemoved = removedRows.reduce(
    (total, rows) => total + rows.length,
    0,
  );
  const allowedValuesRewritten = rewrittenRows.reduce(
    (total, rows) => total + rows.length,
    0,
  );

  return { controlsRemoved, allowedValuesRewritten, unmatchedCategoryCodes };
}
