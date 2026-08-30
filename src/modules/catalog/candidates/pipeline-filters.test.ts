import { describe, expect, it } from 'vitest';
import { PIPELINE_STALE_AFTER_DAYS } from '@/lib/portal/pipeline-params';
import { indexCategorySnapshot } from './cj-category-l1';
import resolvePipelineFilters from './pipeline-filters';

const NOW = new Date('2026-08-30T12:00:00.000Z');

const INDEX = indexCategorySnapshot([
  { categoryId: 'cj-1', path: ["Men's Clothing", 'Pants'] },
  { categoryId: 'cj-2', path: ["Men's Clothing", 'Jeans'] },
  { categoryId: 'cj-3', path: ['Home & Garden'] },
]);

const NONE = { cat: '', stock: undefined, seen: undefined } as const;

describe('resolvePipelineFilters', () => {
  it('is undefined when nothing is filtered, so the tab keeps its cached count', () => {
    expect(resolvePipelineFilters(NONE, INDEX, NOW)).toBeUndefined();
  });

  it('resolves a CJ Level 1 label to the provider category ids under it', () => {
    const filters = resolvePipelineFilters(
      { ...NONE, cat: "Men's Clothing" },
      INDEX,
      NOW,
    );

    expect(filters?.providerCategoryIds?.sort()).toEqual(['cj-1', 'cj-2']);
  });

  it('resolves an unknown label to an EMPTY id list, never to no filter', () => {
    // The distinction this asserts: `[]` reaches `filterCondition` as `false`
    // and matches nothing. If this returned `undefined` instead, a seller who
    // narrowed to a category would be shown the entire tab and would read it
    // as the filter having matched everything.
    const filters = resolvePipelineFilters(
      { ...NONE, cat: 'Automotive' },
      INDEX,
      NOW,
    );

    expect(filters).toEqual({ providerCategoryIds: [] });
  });

  it('treats "reviewed" as every manual state, never as in stock', () => {
    // ADR-013: STOCK_NOT_CHECKED is an honest unknown, and a manual review can
    // record no inventory or could-not-verify just as legitimately as in-stock.
    // Filtering to MANUALLY_IN_STOCK alone would quietly turn a review filter
    // into an availability claim.
    const filters = resolvePipelineFilters(
      { ...NONE, stock: 'checked' },
      INDEX,
      NOW,
    );

    expect(filters?.stockReviewStates).toEqual([
      'MANUALLY_IN_STOCK',
      'MANUALLY_NO_INVENTORY',
      'MANUALLY_COULD_NOT_VERIFY',
    ]);
  });

  it('filters "not checked" to the unknown state alone', () => {
    expect(
      resolvePipelineFilters({ ...NONE, stock: 'unchecked' }, INDEX, NOW)
        ?.stockReviewStates,
    ).toEqual(['STOCK_NOT_CHECKED']);
  });

  it('measures freshness from the given instant, not the wall clock', () => {
    const boundary = new Date(
      NOW.getTime() - PIPELINE_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );

    expect(
      resolvePipelineFilters({ ...NONE, seen: 'fresh' }, INDEX, NOW)?.seenSince,
    ).toEqual(boundary);
    expect(
      resolvePipelineFilters({ ...NONE, seen: 'stale' }, INDEX, NOW)
        ?.seenBefore,
    ).toEqual(boundary);
  });

  it('puts fresh and stale on opposite sides of one boundary', () => {
    const fresh = resolvePipelineFilters(
      { ...NONE, seen: 'fresh' },
      INDEX,
      NOW,
    );
    const stale = resolvePipelineFilters(
      { ...NONE, seen: 'stale' },
      INDEX,
      NOW,
    );

    // One boundary, two complementary predicates — so no row can be both, and
    // none can fall between them.
    expect(fresh?.seenSince).toEqual(stale?.seenBefore);
    expect(fresh?.seenBefore).toBeUndefined();
    expect(stale?.seenSince).toBeUndefined();
  });

  it('combines every facet into one predicate set', () => {
    const filters = resolvePipelineFilters(
      { cat: 'Home & Garden', stock: 'unchecked', seen: 'stale' },
      INDEX,
      NOW,
    );

    expect(filters?.providerCategoryIds).toEqual(['cj-3']);
    expect(filters?.stockReviewStates).toEqual(['STOCK_NOT_CHECKED']);
    expect(filters?.seenBefore).toBeInstanceOf(Date);
  });
});
