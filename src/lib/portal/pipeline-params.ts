import { z } from 'zod';
import { buildHref } from './search-params';

/**
 * URL contract for **Product Sourcing** (`/products/pipeline`).
 *
 * The page keeps its tab, search, page, and the open detail drawer in the URL,
 * which is this codebase's list-view convention (`supplier-products-params.ts`
 * is the same shape for `/products`): a view is shareable, the back button
 * behaves, and the Server Component renders without client state.
 *
 * Every value is bounded or `.catch()`-defaulted, so a hand-edited URL degrades
 * to the safe default rather than reaching the database with something
 * unexpected.
 */

export const PIPELINE_PATH = '/products/pipeline';

/**
 * How many days without a provider sighting counts as stale.
 *
 * Seven, because the pipeline's own screen was reading `8/20` on every row of
 * a `8/30` page — ten days of drift that a raw timestamp reported without ever
 * calling it late. The number is here rather than inline so the filter, the
 * row badge and any test all read one definition.
 */
export const PIPELINE_STALE_AFTER_DAYS = 7;

export const PIPELINE_STOCK_FILTERS = ['checked', 'unchecked'] as const;
export const PIPELINE_SEEN_FILTERS = ['fresh', 'stale'] as const;

export type PipelineStockFilter = (typeof PIPELINE_STOCK_FILTERS)[number];
export type PipelineSeenFilter = (typeof PIPELINE_SEEN_FILTERS)[number];

export const pipelinePageQuerySchema = z.object({
  tab: z.string().optional(),
  q: z.string().max(120).optional(),
  page: z.string().max(12).optional(),
  /**
   * CJ's own Level 1 category label. A LABEL on the wire and an id list in the
   * query: `cj-category-l1.ts` turns it into the provider category ids that sit
   * under it, so an unknown label resolves to no ids and filters everything
   * out rather than silently filtering nothing. Bounded so a hand-typed URL
   * cannot reach the database with an unbounded string.
   */
  cat: z.string().trim().max(120).catch('').default(''),
  /** Manual stock review: only ever narrows, never asserts stock. */
  stock: z.enum(PIPELINE_STOCK_FILTERS).catch('checked').optional(),
  /** Provider feed freshness, against `PIPELINE_STALE_AFTER_DAYS`. */
  seen: z.enum(PIPELINE_SEEN_FILTERS).catch('fresh').optional(),
  /**
   * Candidate UUID whose read-only detail drawer is open. Rejecting a non-UUID
   * here keeps a hand-typed value harmless instead of passing it into a UUID
   * database predicate.
   */
  candidate: z.string().trim().uuid().catch('').default(''),
});

export type PipelinePageQuery = z.infer<typeof pipelinePageQuerySchema>;

/**
 * The parameters every in-page link must carry forward. Only the keys that are
 * actually set, so `buildHref` does not emit `?q=&page=`.
 */
export function pipelineCurrentParams(
  query: PipelinePageQuery,
): Record<string, string> {
  return {
    ...(query.tab === undefined ? {} : { tab: query.tab }),
    ...(query.q === undefined || query.q === '' ? {} : { q: query.q }),
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.cat === '' ? {} : { cat: query.cat }),
    ...(query.stock === undefined ? {} : { stock: query.stock }),
    ...(query.seen === undefined ? {} : { seen: query.seen }),
    ...(query.candidate === '' ? {} : { candidate: query.candidate }),
  };
}

/** Filter keys only — what a "clear filters" control has to remove. */
export const PIPELINE_FILTER_KEYS = ['cat', 'stock', 'seen'] as const;

/** True when at least one filter is applied, i.e. the count is a subset. */
export function hasPipelineFilters(query: PipelinePageQuery): boolean {
  return (
    query.cat !== '' || query.stock !== undefined || query.seen !== undefined
  );
}

/**
 * The href that sets one filter, or removes it when `value` is null.
 *
 * `page` is deliberately NOT preserved: changing a filter changes the result
 * set, and keeping page 7 across it is how a seller lands on an empty page and
 * reads it as no matches. That is the opposite of the drawer case above, where
 * the result set does not change at all.
 */
export function pipelineFilterHref(
  current: Record<string, string>,
  key: (typeof PIPELINE_FILTER_KEYS)[number],
  value: string | null,
): string {
  return buildHref(PIPELINE_PATH, current, { [key]: value });
}

/** Clears every filter at once, leaving the tab and the search term alone. */
export function pipelineClearFiltersHref(
  current: Record<string, string>,
): string {
  return buildHref(
    PIPELINE_PATH,
    current,
    Object.fromEntries(PIPELINE_FILTER_KEYS.map((key) => [key, null])),
  );
}

/**
 * `buildQueryString` deletes `page` whenever a patch changes anything else, so
 * that a new *filter* never lands the seller on an empty page 7. Opening or
 * closing a drawer is not a filter - it does not change the result set at all -
 * so without an explicit `page` here, clicking a row on page 7 of Blocked would
 * silently return the list to page 1, and the candidate that was clicked would
 * not even be among the rows behind the drawer.
 *
 * Passing `page` in the patch suppresses that reset (see
 * `search-params.ts`'s `patch.page === undefined` check); `null` removes the
 * key when there was no page to keep.
 */
function keepPage(current: Record<string, string>) {
  return { page: current.page ?? null };
}

export function candidateDrawerHref(
  current: Record<string, string>,
  candidateId: string,
): string {
  return buildHref(PIPELINE_PATH, current, {
    ...keepPage(current),
    candidate: candidateId,
  });
}

export function closeCandidateHref(current: Record<string, string>): string {
  return buildHref(PIPELINE_PATH, current, {
    ...keepPage(current),
    candidate: null,
  });
}
