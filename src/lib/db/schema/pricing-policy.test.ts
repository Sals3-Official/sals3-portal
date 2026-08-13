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
  it('holds at most one ACTIVE policy per seller per category', () => {
    const index = indexNamed(
      pricingCategoryPolicies,
      'pricing_category_policies_active_key',
    );

    expect(index?.config.unique).toBe(true);
    expect(
      columnNamesOf(
        pricingCategoryPolicies,
        'pricing_category_policies_active_key',
      ),
    ).toEqual(['seller_account_id', 'category_id']);
    expect(index?.config.where).toBeDefined();
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
