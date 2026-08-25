import { describe, expect, it, vi } from 'vitest';
import type {
  PricingCategoryPolicyRow,
  Sals3CategoryRow,
} from '@/lib/db/schema';
import {
  CATEGORY_PATH_SEPARATOR,
  findNearestActiveCategoryPolicy,
} from './repository';

/**
 * **Depth beats market** — owner decision, 2026-08-25, confirmed explicitly.
 *
 * These are the cases that decide whether a per-destination rate is a useful
 * override or a silent one. If market outranked depth, setting a single country
 * rate on a department would quietly replace every product-level decision
 * beneath it, and nothing on the screen would show that it had.
 *
 * A fake executor answers with canned rows, so what is exercised is the
 * precedence rule rather than the SQL — the `WHERE` is Postgres's job, per the
 * convention `repository.test.ts` documents.
 */

function category(path: string): Sals3CategoryRow {
  const segments = path.split(CATEGORY_PATH_SEPARATOR);

  return {
    id: `id-${path}`,
    code: `CAT-GGL-${segments.length}`,
    l1: segments[0] ?? null,
    l2: segments[1] ?? null,
    l3: segments[2] ?? null,
    l4: null,
    l5: null,
    path,
    taxonomyStatus: 'ADOPTED',
    createdAt: new Date('2026-08-01T00:00:00Z'),
  } as Sals3CategoryRow;
}

function policy(
  id: string,
  marketCode: string | null,
): PricingCategoryPolicyRow {
  return {
    id,
    sellerAccountId: 'seller-1',
    categoryId: `category-${id}`,
    marketCode,
    targetMarginRate: '0.250000',
    roundingRule: 'NONE',
    status: 'ACTIVE',
    version: 1,
  } as PricingCategoryPolicyRow;
}

function fakeExecutor(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));

  return { select: vi.fn(() => ({ from })) } as never;
}

const DEPARTMENT = 'Apparel & Accessories';
const GROUP = 'Apparel & Accessories > Clothing';
const LEAF = 'Apparel & Accessories > Clothing > Shirts & Tops';

async function resolve(rows: unknown[]) {
  return findNearestActiveCategoryPolicy(
    fakeExecutor(rows),
    'seller-1',
    category(LEAF),
    'AU',
  );
}

describe('depth beats market', () => {
  it('prefers a deeper unscoped rule over a shallower rule for this destination', async () => {
    const result = await resolve([
      { category: category(DEPARTMENT), policy: policy('department-au', 'AU') },
      { category: category(LEAF), policy: policy('leaf-any', null) },
    ]);

    /**
     * The case the whole rule exists for. A seller who set an AU rate on the
     * department has NOT overridden the specific decision they made on the leaf
     * — the leaf is the more specific statement about this product, and a
     * destination rate one level up must not reach past it.
     */
    expect(result?.policy.id).toBe('leaf-any');
  });

  it('prefers this destination over all-destinations at the same depth', async () => {
    const result = await resolve([
      { category: category(LEAF), policy: policy('leaf-any', null) },
      { category: category(LEAF), policy: policy('leaf-au', 'AU') },
    ]);

    // Market is the tie-break *within* one depth, which is the only place the
    // two partial unique indexes allow both rows to exist.
    expect(result?.policy.id).toBe('leaf-au');
  });

  it('does not depend on the order the rows come back in', async () => {
    const scoped = {
      category: category(LEAF),
      policy: policy('leaf-au', 'AU'),
    };
    const unscoped = {
      category: category(LEAF),
      policy: policy('leaf-any', null),
    };

    // A reduce that only ever replaced on a strict improvement would give a
    // different answer for a different physical row order — an unreproducible
    // price.
    await expect(resolve([scoped, unscoped])).resolves.toMatchObject({
      policy: { id: 'leaf-au' },
    });
    await expect(resolve([unscoped, scoped])).resolves.toMatchObject({
      policy: { id: 'leaf-au' },
    });
  });

  it('still walks the chain when this destination has nothing anywhere', async () => {
    const result = await resolve([
      { category: category(GROUP), policy: policy('group-any', null) },
    ]);

    // The query widens to `market = $x OR market IS NULL`; it does not narrow.
    // A seller who has configured no destination-specific rule must keep every
    // margin they already had.
    expect(result?.policy.id).toBe('group-any');
  });

  it('returns null when the chain carries nothing at all', async () => {
    await expect(resolve([])).resolves.toBeNull();
  });

  it('picks the deepest when several ancestors are priced for this destination', async () => {
    const result = await resolve([
      { category: category(DEPARTMENT), policy: policy('department-au', 'AU') },
      { category: category(GROUP), policy: policy('group-au', 'AU') },
    ]);

    expect(result?.policy.id).toBe('group-au');
    expect(result?.sourceCategory.path).toBe(GROUP);
  });
});
