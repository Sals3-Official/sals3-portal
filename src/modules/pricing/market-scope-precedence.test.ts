import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
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
 * **Depth decides, within one scope** — owner decision 2026-08-25 ("depth beats
 * market"), narrowed by owner decision 2026-08-27 (Global covers only the
 * countries with no column of their own).
 *
 * These are the cases that decide whether a per-destination rate is a useful
 * override or a silent one. If market outranked depth, setting a single country
 * rate on a department would quietly replace every product-level decision
 * beneath it, and nothing on the screen would show that it had.
 *
 * Two halves, deliberately tested by two different means:
 *
 * 1. **Which scope's rows the query asks for** is a `WHERE`/`ON` clause, so it
 *    is pinned by rendering the SQL through `PgDialect` — the convention
 *    `category-margin-scope.test.ts` established, and the only way to see it,
 *    since a drizzle `SQL` has no meaningful `toString()`.
 * 2. **Which of the returned rows wins** is pinned with a fake executor
 *    answering canned rows.
 *
 * The fake ignores the join condition, so every fixture below is deliberately
 * **single-scoped**. Since 2026-08-27 a mixed-scope result set is not something
 * the query can return, and a test that fed one would be asserting behaviour
 * for a state the database cannot produce.
 */

const dialect = new PgDialect();

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

/** Captures the join condition so the scope predicate can be rendered. */
function recordingExecutor() {
  const joins: string[] = [];
  const where = vi.fn().mockResolvedValue([]);
  const innerJoin = vi.fn((_table: unknown, condition: SQL | undefined) => {
    joins.push(
      condition === undefined ? '' : dialect.sqlToQuery(condition).sql,
    );

    return { where };
  });
  const from = vi.fn(() => ({ innerJoin }));

  return { executor: { select: vi.fn(() => ({ from })) } as never, joins };
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
  it('prefers a deeper rule over a shallower one for the same destination', async () => {
    const result = await resolve([
      { category: category(DEPARTMENT), policy: policy('department-au', 'AU') },
      { category: category(LEAF), policy: policy('leaf-au', 'AU') },
    ]);

    /**
     * The case the whole rule exists for. A seller who set a rate on the
     * department has NOT overridden the specific decision they made on the leaf
     * — the leaf is the more specific statement about this product, and a rate
     * one level up must not reach past it.
     */
    expect(result?.policy.id).toBe('leaf-au');
  });

  it('does not depend on the order the rows come back in', async () => {
    const deep = { category: category(LEAF), policy: policy('leaf-au', 'AU') };
    const shallow = {
      category: category(GROUP),
      policy: policy('group-au', 'AU'),
    };

    // A reduce that only ever replaced on a strict improvement would give a
    // different answer for a different physical row order — an unreproducible
    // price.
    await expect(resolve([deep, shallow])).resolves.toMatchObject({
      policy: { id: 'leaf-au' },
    });
    await expect(resolve([shallow, deep])).resolves.toMatchObject({
      policy: { id: 'leaf-au' },
    });
  });
});

describe('a named destination and Global never see each other', () => {
  /**
   * The rule the 2026-08-27 decision turns on, and it lives in the join
   * condition rather than in `outranks`. A Global rule set on a deep category
   * used to win an Australian order outright, because the query returned it and
   * depth beat market. Both halves of that are gone: Australia no longer asks
   * for `NULL` rows at all.
   */
  it('asks only for this destination when the country has a column', async () => {
    const { executor, joins } = recordingExecutor();

    await findNearestActiveCategoryPolicy(
      executor,
      'seller-1',
      category(LEAF),
      'AU',
    );

    expect(joins).toHaveLength(1);
    expect(joins[0]).toContain('"market_code" = $');
    expect(joins[0]).not.toContain('is null');
  });

  it('asks only for Global when the country has no column', async () => {
    const { executor, joins } = recordingExecutor();

    // Great Britain is a real country code and deliberately not one of the six.
    await findNearestActiveCategoryPolicy(
      executor,
      'seller-1',
      category(LEAF),
      'GB',
    );

    expect(joins).toHaveLength(1);
    expect(joins[0]).toContain('"market_code" is null');
    expect(joins[0]).not.toContain('"market_code" = $');
  });

  it('resolves a Global rule for a country with no column', async () => {
    const result = await findNearestActiveCategoryPolicy(
      fakeExecutor([
        { category: category(GROUP), policy: policy('group-global', null) },
      ]),
      'seller-1',
      category(LEAF),
      'GB',
    );

    expect(result?.policy.id).toBe('group-global');
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

describe('a write lands in the scope the screen was showing', () => {
  it('requires a scope on createStoreDefault rather than defaulting it', async () => {
    const { createStoreDefault } = await import('./repository');

    /**
     * A compile-time guarantee, asserted here so the reason survives.
     *
     * `marketCode` was briefly absent from this input. Every call site still
     * compiled, and `saveStoreDefaultAction` read the destination's row and
     * then created an **unscoped** one — writing the all-destinations rule
     * under a heading that said otherwise. Optional-with-a-null-default would
     * reintroduce exactly that, silently.
     *
     * The function is only referenced here; the real protection is the required
     * property on its input type, which turns the omission into a type error.
     */
    expect(typeof createStoreDefault).toBe('function');
  });
});
