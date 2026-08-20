import { and, asc, eq, ne } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import {
  ACTIVE_ATTRIBUTE_CONTROLS_VERSION,
  categoryAttributeControls,
  productCategoryAttributeValues,
  products,
  type AttributeRequirementLevel,
} from '@/lib/db/schema';
import { categoryAttributeValueDisplayLabel } from '@/lib/seller-center/product-editor/attribute-display-defaults';

/**
 * One buyer-facing product specification: the seller's own answer to a
 * category attribute control.
 *
 * This is deliberately **not** the same thing as `StorefrontSpecs`. `specs`
 * carries technical facts the supplier reported and Sals3 repeats (weight,
 * dimensions, GTIN, MPN, condition). A `specification` row is a claim the
 * seller made themselves, against the attribute set their category defines —
 * so the two cannot share one table or one provenance line on the PDP without
 * misattributing the seller's declaration to CJ.
 */
export type StorefrontSpecification = {
  /**
   * The workbook's own `attributeName`, verbatim — e.g. `Material`,
   * `Country of Origin`. Not re-cased and not re-worded: the workbook is the
   * authority on what the attribute is called, and a prettier label invented
   * here would drift from what the seller was asked in the editor.
   */
  label: string;
  /**
   * The seller's value(s), display-mapped and joined. Multi-select controls
   * legitimately hold several values (`Autumn`, `Winter`), and a buyer reads
   * them as one answer.
   */
  value: string;
};

/** Same order the editor's Specification section groups its fields in. */
const REQUIREMENT_ORDER: AttributeRequirementLevel[] = [
  'REQUIRED',
  'RECOMMENDED',
  'OPTIONAL',
];

/**
 * The seller-entered category attributes that may be shown to a buyer.
 *
 * ## Three filters, each load-bearing
 *
 * **Recognised under the product's *current* category.** The join is on
 * `products.category_id`, not on the `controls_version` snapshot the value was
 * saved against. `product_category_attribute_values`'s own header explains
 * why: a stored value is never dropped when a seller changes category, so a
 * row can survive as reference data while no longer belonging to the product's
 * contract. An unrecognised attribute is simply absent here rather than
 * published as a fact about a category that does not define it. A product with
 * no `category_id` at all matches nothing, which is the fail-closed direction.
 *
 * **`ATTRIBUTE_CONTEXT_ONLY` never reaches a buyer.** The workbook itself
 * classifies each attribute's `seo_visibility`, and that column — not a
 * judgement made here — decides what belongs on a public page. Omitting the
 * filter would publish internal merchandising context as product copy.
 *
 * **Empty values produce no row.** `values` is an array and may legitimately be
 * empty for a saved-then-cleared field. Absent means nobody recorded the fact,
 * which is the same rule every other optional field on this payload follows,
 * and it is what keeps a defaulted `Others` origin out of the payload: the
 * editor shows `Others` as a *placeholder* for an undecided field, so an
 * undecided origin has no stored value and therefore no row.
 *
 * Zero supplier calls — `products` and two catalogue tables (ADR-017).
 */
export async function loadSpecification(
  executor: DbExecutor,
  productId: string,
): Promise<StorefrontSpecification[]> {
  const rows = await executor
    .select({
      attributeName: productCategoryAttributeValues.attributeName,
      values: productCategoryAttributeValues.values,
      requirementLevel: categoryAttributeControls.requirementLevel,
    })
    .from(productCategoryAttributeValues)
    .innerJoin(
      products,
      eq(products.id, productCategoryAttributeValues.productId),
    )
    .innerJoin(
      categoryAttributeControls,
      and(
        eq(categoryAttributeControls.categoryId, products.categoryId),
        eq(
          categoryAttributeControls.attributeName,
          productCategoryAttributeValues.attributeName,
        ),
        eq(
          categoryAttributeControls.controlsVersion,
          ACTIVE_ATTRIBUTE_CONTROLS_VERSION,
        ),
        ne(categoryAttributeControls.seoVisibility, 'ATTRIBUTE_CONTEXT_ONLY'),
      ),
    )
    .where(eq(productCategoryAttributeValues.productId, productId))
    .orderBy(asc(productCategoryAttributeValues.attributeName));

  return REQUIREMENT_ORDER.flatMap((requirement) =>
    rows
      .filter((row) => row.requirementLevel === requirement)
      .flatMap((row) => {
        const value = row.values
          .map((raw) =>
            categoryAttributeValueDisplayLabel(row.attributeName, raw.trim()),
          )
          .filter(Boolean)
          .join(', ');

        return value === ''
          ? []
          : [
              {
                label: row.attributeName,
                value,
              } satisfies StorefrontSpecification,
            ];
      }),
  );
}
