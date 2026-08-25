import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  pricingCategoryPolicies,
  pricingFxAdjustmentPolicies,
  pricingProductOverrides,
  pricingVariantOverrides,
  sals3Categories,
} from './pricing-policy';

/**
 * "At most one ACTIVE policy for X" is a database constraint, not an
 * application convention — asserted here without needing a database, same
 * pattern as `supplier-connections.test.ts`. The `where` assertion is the
 * point: dropping the partial `WHERE status = 'ACTIVE'` clause would make
 * the index unconditional and reject every edit (which must supersede, not
 * coexist with, the row it replaces).
 */
function indexNamed(table: Parameters<typeof getTableConfig>[0], name: string) {
  return getTableConfig(table).indexes.find(
    (index) => index.config.name === name,
  );
}

function columnNamesOf(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
): string[] {
  return (indexNamed(table, name)?.config.columns ?? []).map((column) =>
    'name' in column && typeof column.name === 'string'
      ? column.name
      : String(column),
  );
}

describe('pricing_category_policies constraints', () => {
  /**
   * One ACTIVE policy per scope, in **two** partial indexes.
   *
   * Postgres treats NULLs as distinct in a unique index, so folding
   * `market_code` into the original `(seller_account_id, category_id)` index
   * would have accepted two ACTIVE all-destinations policies for one category
   * and left the resolver with no deterministic row to choose. Both halves are
   * asserted because losing either one loses the guarantee on that side only —
   * quietly, and not until two rows actually collide.
   */
  it('holds at most one ACTIVE all-destinations policy per seller per category', () => {
    const name = 'pricing_category_policies_active_all_markets_key';

    expect(indexNamed(pricingCategoryPolicies, name)?.config.unique).toBe(true);
    expect(columnNamesOf(pricingCategoryPolicies, name)).toEqual([
      'seller_account_id',
      'category_id',
    ]);
    expect(
      indexNamed(pricingCategoryPolicies, name)?.config.where,
    ).toBeDefined();
  });

  it('holds at most one ACTIVE policy per seller per category per destination', () => {
    const name = 'pricing_category_policies_active_market_key';

    expect(indexNamed(pricingCategoryPolicies, name)?.config.unique).toBe(true);
    expect(columnNamesOf(pricingCategoryPolicies, name)).toEqual([
      'seller_account_id',
      'category_id',
      'market_code',
    ]);
    expect(
      indexNamed(pricingCategoryPolicies, name)?.config.where,
    ).toBeDefined();
  });

  it('no longer carries the single index that could not tell the two apart', () => {
    // Left behind, this would silently duplicate the all-markets guarantee and
    // make `drizzle-kit` want to recreate an index production no longer has.
    expect(
      indexNamed(
        pricingCategoryPolicies,
        'pricing_category_policies_active_key',
      ),
    ).toBeUndefined();
  });
});

describe('pricing_product_overrides constraints', () => {
  it('holds at most one ACTIVE override per candidate', () => {
    const index = indexNamed(
      pricingProductOverrides,
      'pricing_product_overrides_active_key',
    );

    expect(index?.config.unique).toBe(true);
    expect(
      columnNamesOf(
        pricingProductOverrides,
        'pricing_product_overrides_active_key',
      ),
    ).toEqual(['supplier_candidate_id']);
    expect(index?.config.where).toBeDefined();
  });
});

describe('pricing_variant_overrides constraints', () => {
  it('holds at most one ACTIVE override per candidate+variant', () => {
    const index = indexNamed(
      pricingVariantOverrides,
      'pricing_variant_overrides_active_key',
    );

    expect(index?.config.unique).toBe(true);
    expect(
      columnNamesOf(
        pricingVariantOverrides,
        'pricing_variant_overrides_active_key',
      ),
    ).toEqual(['supplier_candidate_id', 'supplier_variant_id']);
    expect(index?.config.where).toBeDefined();
  });
});

describe('pricing_fx_adjustment_policies constraints', () => {
  it('holds at most one ACTIVE funding buffer per seller', () => {
    const index = indexNamed(
      pricingFxAdjustmentPolicies,
      'pricing_fx_adjustment_policies_active_key',
    );

    expect(index?.config.unique).toBe(true);
    expect(
      columnNamesOf(
        pricingFxAdjustmentPolicies,
        'pricing_fx_adjustment_policies_active_key',
      ),
    ).toEqual(['seller_account_id']);
    expect(index?.config.where).toBeDefined();
  });
});

describe('sals3_categories constraints', () => {
  it('holds a unique stable code per category', () => {
    const index = indexNamed(sals3Categories, 'sals3_categories_code_key');

    expect(index?.config.unique).toBe(true);
    expect(columnNamesOf(sals3Categories, 'sals3_categories_code_key')).toEqual(
      ['code'],
    );
  });
});
