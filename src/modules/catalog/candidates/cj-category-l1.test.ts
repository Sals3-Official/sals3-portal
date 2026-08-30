import { describe, expect, it } from 'vitest';
import {
  categoryIdsForL1,
  EMPTY_CJ_CATEGORY_INDEX,
  indexCategorySnapshot,
} from './cj-category-l1';

/**
 * `discovery_cycles.category_snapshot` is `jsonb` written from
 * `SupplierCategoryLeaf[]`, so everything here is about reading a shape that
 * arrives untyped and may predate a field.
 */
describe('indexCategorySnapshot', () => {
  const snapshot = [
    {
      categoryId: 'cj-1',
      categoryName: 'Casual Pants',
      path: ["Men's Clothing", 'Pants'],
    },
    {
      categoryId: 'cj-2',
      categoryName: 'Jeans',
      path: ["Men's Clothing", 'Jeans'],
    },
    { categoryId: 'cj-3', categoryName: 'Drinkware', path: ['Home & Garden'] },
  ];

  it('maps each provider category id to CJ Level 1', () => {
    expect(indexCategorySnapshot(snapshot).l1ById).toEqual({
      'cj-1': "Men's Clothing",
      'cj-2': "Men's Clothing",
      'cj-3': 'Home & Garden',
    });
  });

  it('lists each Level 1 once, sorted, so the filter order is stable', () => {
    expect(indexCategorySnapshot(snapshot).l1Labels).toEqual([
      'Home & Garden',
      "Men's Clothing",
    ]);
  });

  it('drops an entry with no Level 1 rather than inventing one', () => {
    const index = indexCategorySnapshot([
      { categoryId: 'cj-9', categoryName: 'Orphan', path: [] },
      { categoryId: 'cj-10', categoryName: 'No path at all' },
      { categoryId: 'cj-11', path: ['  '] },
    ]);

    expect(index).toEqual(EMPTY_CJ_CATEGORY_INDEX);
  });

  it('drops an entry with no id, because a label cannot answer a lookup', () => {
    expect(
      indexCategorySnapshot([{ categoryName: 'Nameless', path: ['Anything'] }])
        .l1ById,
    ).toEqual({});
  });

  it.each([null, undefined, 42, 'not an array', {}])(
    'returns the empty index for %s rather than throwing',
    (value) => {
      expect(indexCategorySnapshot(value)).toEqual(EMPTY_CJ_CATEGORY_INDEX);
    },
  );

  it('keeps reading later entries after a malformed one', () => {
    const index = indexCategorySnapshot([
      { nonsense: true },
      { categoryId: 'cj-4', path: ['Beauty & Health'] },
    ]);

    expect(index.l1ById).toEqual({ 'cj-4': 'Beauty & Health' });
  });
});

describe('categoryIdsForL1', () => {
  const index = indexCategorySnapshot([
    { categoryId: 'cj-1', path: ["Men's Clothing", 'Pants'] },
    { categoryId: 'cj-2', path: ["Men's Clothing", 'Jeans'] },
    { categoryId: 'cj-3', path: ['Home & Garden'] },
  ]);

  it('returns every provider category under one Level 1', () => {
    expect(categoryIdsForL1(index, "Men's Clothing").sort()).toEqual([
      'cj-1',
      'cj-2',
    ]);
  });

  it('returns nothing for a label the snapshot does not carry', () => {
    // Load-bearing: `filterCondition` turns an empty list into `false`, so an
    // unknown label filters everything OUT. Returning every id here, or having
    // the caller treat empty as "no filter", would answer a narrowed request
    // with the whole unfiltered tab.
    expect(categoryIdsForL1(index, 'Automotive')).toEqual([]);
  });
});
