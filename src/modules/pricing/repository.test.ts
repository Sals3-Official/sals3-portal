import { describe, expect, it, vi } from 'vitest';
import type { Sals3CategoryRow } from '@/lib/db/schema';
import {
  CATEGORY_PATH_SEPARATOR,
  findNearestActiveCategoryPolicy,
} from './repository';

/**
 * Covers `findNearestActiveCategoryPolicy`'s chain derivation and
 * deepest-wins selection in pure logic, with a fake executor that only
 * records the query's shape and answers with canned rows. The deep
 * `WHERE`/`JOIN` correctness of the plain CRUD functions is Postgres's
 * job, out of scope for a hand-rolled fake executor — same convention
 * `src/modules/market-config/repository.test.ts` documents.
 */

function category(path: string, code = `CODE-${path}`): Sals3CategoryRow {
  const segments = path.split(CATEGORY_PATH_SEPARATOR);

  return {
    id: `id-${code}`,
    code,
    l1: segments[0] ?? null,
    l2: segments[1] ?? null,
    l3: segments[2] ?? null,
    l4: segments[3] ?? null,
    l5: segments[4] ?? null,
    path,
    taxonomyStatus: 'ADOPTED',
    createdAt: new Date('2026-08-01T00:00:00Z'),
  } as Sals3CategoryRow;
}

function policyRow(id: string) {
  return {
    id,
    sellerAccountId: 'seller-1',
    categoryId: `category-${id}`,
    targetMarginRate: '0.300000',
    roundingRule: 'NONE',
    status: 'ACTIVE',
    version: 1,
  };
}

/**
 * A fake executor for the one query shape this function issues:
 * `.select().from().innerJoin().where()` resolving to rows.
 */
function fakeExecutor(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));

  return { executor: { select } as never, select, where };
}

describe('findNearestActiveCategoryPolicy', () => {
  it('returns null when no node on the chain carries an active policy', async () => {
    const { executor } = fakeExecutor([]);

    const result = await findNearestActiveCategoryPolicy(
      executor,
      'seller-1',
      category('Apparel & Accessories > Clothing > Shirts & Tops'),
    );

    expect(result).toBeNull();
  });

  it("returns the category's own policy when it has one — self is the deepest node on its own chain", async () => {
    const self = category('Apparel & Accessories > Clothing');
    const department = category('Apparel & Accessories');
    const { executor } = fakeExecutor([
      { category: department, policy: policyRow('dept') },
      { category: self, policy: policyRow('self') },
    ]);

    const result = await findNearestActiveCategoryPolicy(
      executor,
      'seller-1',
      self,
    );

    expect(result?.policy.id).toBe('self');
    expect(result?.sourceCategory.path).toBe(self.path);
  });

  it('falls back to the nearest priced ancestor, not the shallowest', async () => {
    const leaf = category(
      'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets',
    );
    const department = category('Apparel & Accessories');
    const middle = category('Apparel & Accessories > Clothing');
    const { executor } = fakeExecutor([
      { category: department, policy: policyRow('dept') },
      { category: middle, policy: policyRow('middle') },
    ]);

    const result = await findNearestActiveCategoryPolicy(
      executor,
      'seller-1',
      leaf,
    );

    // "Clothing" is deeper than the department — the nearest wins.
    expect(result?.policy.id).toBe('middle');
    expect(result?.sourceCategory.path).toBe(
      'Apparel & Accessories > Clothing',
    );
  });

  it('a department-only policy prices a depth-5 leaf', async () => {
    const leaf = category(
      'Home & Garden > Kitchen & Dining > Cookware > Pots > Stockpots',
    );
    const department = category('Home & Garden');
    const { executor } = fakeExecutor([
      { category: department, policy: policyRow('dept') },
    ]);

    const result = await findNearestActiveCategoryPolicy(
      executor,
      'seller-1',
      leaf,
    );

    expect(result?.policy.id).toBe('dept');
    expect(result?.sourceCategory.path).toBe('Home & Garden');
  });

  it('a department row (depth 1) checks only itself', async () => {
    const department = category('Electronics');
    const { executor, where } = fakeExecutor([
      { category: department, policy: policyRow('dept') },
    ]);

    const result = await findNearestActiveCategoryPolicy(
      executor,
      'seller-1',
      department,
    );

    expect(result?.policy.id).toBe('dept');
    expect(where).toHaveBeenCalledTimes(1);
  });
});
