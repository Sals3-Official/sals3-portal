import { describe, expect, it } from 'vitest';
import {
  groupCategoryMarginRowsByL2,
  type CategoryMarginLeafRow,
} from './repository';

/**
 * Covers `groupCategoryMarginRowsByL2` in pure logic — no I/O, so no fake
 * executor is needed. `listCategoryMarginOverview`/`findLeafCategoriesByL1L2`
 * are query-builder functions whose deep `WHERE`/`LEFT JOIN` correctness is
 * Postgres's job, out of scope for a hand-rolled fake executor — same
 * convention `src/modules/market-config/repository.test.ts` documents; that
 * behaviour was confirmed manually against the real local database (1,345
 * leaves, 226 L2 groups, correct `LEFT JOIN` null-policy behaviour) while
 * building this module.
 */

function leaf(
  overrides: Partial<CategoryMarginLeafRow> = {},
): CategoryMarginLeafRow {
  return {
    categoryId: 'category-1',
    code: 'CAT-DIG-100801',
    path: 'Digital Goods > Mobile Load > Telco Load Top-up',
    l1: 'Digital Goods',
    l2: 'Mobile Load',
    l3: 'Telco Load Top-up',
    policy: null,
    ...overrides,
  };
}

describe('groupCategoryMarginRowsByL2', () => {
  it('groups leaves by the (l1, l2) pair, not by l3 or the leaf itself', () => {
    const rows = [
      leaf({ categoryId: 'a', code: 'CAT-A' }),
      leaf({ categoryId: 'b', code: 'CAT-B', l3: 'A different L3' }),
      leaf({ categoryId: 'c', code: 'CAT-C', l1: 'Beauty', l2: 'Hair Care' }),
    ];

    const groups = groupCategoryMarginRowsByL2(rows);

    expect(groups).toHaveLength(2);
    const digital = groups.find(
      (g) => g.groupKey === 'Digital Goods::Mobile Load',
    );
    expect(digital?.leaves.map((l) => l.categoryId)).toEqual(['a', 'b']);
    const beauty = groups.find((g) => g.groupKey === 'Beauty::Hair Care');
    expect(beauty?.leaves.map((l) => l.categoryId)).toEqual(['c']);
  });

  it('a group with zero active policies still appears — never hidden for being empty', () => {
    const rows = [
      leaf({ policy: null }),
      leaf({ categoryId: 'b', policy: null }),
    ];

    const groups = groupCategoryMarginRowsByL2(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0].leaves).toHaveLength(2);
    expect(groups[0].leaves.every((l) => l.policy === null)).toBe(true);
  });

  it('preserves each leaf`s own policy detail for the caller to derive uniform/mixed state from', () => {
    const rows = [
      leaf({
        categoryId: 'a',
        policy: {
          id: 'policy-a',
          targetMarginRate: '0.300000',
          roundingRule: 'NONE',
          version: 1,
          updatedAt: new Date('2026-08-01T00:00:00Z'),
        },
      }),
      leaf({
        categoryId: 'b',
        policy: {
          id: 'policy-b',
          targetMarginRate: '0.150000',
          roundingRule: 'NEAREST_0_99',
          version: 3,
          updatedAt: new Date('2026-08-02T00:00:00Z'),
        },
      }),
    ];

    const groups = groupCategoryMarginRowsByL2(rows);

    expect(groups[0].leaves[0].policy?.targetMarginRate).toBe('0.300000');
    expect(groups[0].leaves[1].policy?.roundingRule).toBe('NEAREST_0_99');
  });

  it('buckets a null l1/l2 under "(Uncategorized)" rather than dropping the row', () => {
    const rows = [leaf({ l1: null, l2: null })];

    const groups = groupCategoryMarginRowsByL2(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0].l1).toBe('(Uncategorized)');
    expect(groups[0].l2).toBe('(Uncategorized)');
    expect(groups[0].leaves).toHaveLength(1);
  });

  it('returns an empty array for an empty input, not an error', () => {
    expect(groupCategoryMarginRowsByL2([])).toEqual([]);
  });
});
