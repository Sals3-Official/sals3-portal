import {
  PIPELINE_STALE_AFTER_DAYS,
  type PipelinePageQuery,
} from '@/lib/portal/pipeline-params';
import { categoryIdsForL1, type CjCategoryIndex } from './cj-category-l1';
import type { CandidateFilters } from './queries';

/**
 * Turns the URL's filter parameters into the SQL predicate set.
 *
 * Pure, and takes `now` and the category index as arguments, so the whole
 * translation is testable without a database, a clock or a supplier call —
 * which matters because two of the three decisions here are easy to get
 * quietly wrong.
 *
 * ## An unknown category filters everything OUT, never nothing
 *
 * `cat` carries CJ's Level 1 LABEL, and the label is resolved to provider
 * category ids here. A label that matches nothing in the snapshot yields an
 * empty id list, and `filterCondition` turns an empty list into `false` rather
 * than dropping the predicate. The alternative — treating "no ids" as "no
 * filter" — would answer a narrowed request with the entire unfiltered tab,
 * which reads as though the filter had been applied and found everything.
 *
 * ## Stock is a review state, not a stock level
 *
 * `STOCK_NOT_CHECKED` is an honest unknown that no automated CJ query may
 * change (ADR-013). `Reviewed` therefore means a person recorded an
 * observation, in either direction — it never claims the product is in stock.
 */
export default function resolvePipelineFilters(
  query: Pick<PipelinePageQuery, 'cat' | 'stock' | 'seen'>,
  index: CjCategoryIndex,
  now: Date,
): CandidateFilters | undefined {
  const filters: CandidateFilters = {};

  if (query.cat !== '') {
    filters.providerCategoryIds = categoryIdsForL1(index, query.cat);
  }

  if (query.stock === 'checked') {
    filters.stockReviewStates = [
      'MANUALLY_IN_STOCK',
      'MANUALLY_NO_INVENTORY',
      'MANUALLY_COULD_NOT_VERIFY',
    ];
  }

  if (query.stock === 'unchecked') {
    filters.stockReviewStates = ['STOCK_NOT_CHECKED'];
  }

  if (query.seen !== undefined) {
    const boundary = new Date(
      now.getTime() - PIPELINE_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );

    if (query.seen === 'fresh') filters.seenSince = boundary;
    if (query.seen === 'stale') filters.seenBefore = boundary;
  }

  return Object.keys(filters).length === 0 ? undefined : filters;
}
