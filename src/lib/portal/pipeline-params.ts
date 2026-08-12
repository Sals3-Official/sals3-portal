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

export const pipelinePageQuerySchema = z.object({
  tab: z.string().optional(),
  q: z.string().max(120).optional(),
  page: z.string().max(12).optional(),
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
    ...(query.candidate === '' ? {} : { candidate: query.candidate }),
  };
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
