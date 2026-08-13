import { countForTab, type PipelineTab } from '@/lib/portal/pipeline-tabs';
import { resolvePageWindow, type PageWindow } from '@/lib/portal/pagination';
import getDb from '@/lib/db/client';
import { listCandidateIdsWithProducts } from '@/modules/catalog/products/repository';
import {
  countCandidatesByStatus,
  countDeadLetteredEvaluations,
  countEvaluatingCandidates,
  listCandidatesByStatus,
  listDeadLetteredEvaluations,
  listEvaluatingCandidates,
  oldestQueuedAgeMs,
  PIPELINE_PAGE_SIZE,
  type CandidateStatusCounts,
  type EvaluatedCandidateRow,
} from './queries';
import { EVALUATION_STATUSES } from './rules/contracts';
import readCandidateStatusCounts from './status-counts-cache';

/**
 * Data orchestration for `/products/pipeline`: which query backs which tab,
 * how one page of it is resolved, and what a read failure degrades to. Kept
 * out of `page.tsx` so the route file stays composition only.
 *
 * Every tab is paged. A tab can hold tens of thousands of rows - the blocked
 * tab does whenever a market policy blocks the whole discovered feed - so
 * "show everything" is a page at a time plus a total, never one response
 * carrying the whole tab.
 */

/** Statuses behind the tabs that are a plain status filter. */
const TAB_STATUSES = {
  ready: ['PASS'],
  'needs-attention': ['PASS_WITH_ATTENTION'],
  blocked: ['BLOCKED', 'TEMPORARILY_INELIGIBLE'],
  // Every status, unsplit by attemptCount - "all" means literally every row
  // regardless of which of the other four tabs an `EVALUATION_FAILED` row
  // currently belongs to.
  all: [...EVALUATION_STATUSES],
} as const;

export type PipelinePageData = {
  /** Null when no real count was resolvable this request - the tab bar renders 0 rather than guess. */
  counts: CandidateStatusCounts | null;
  candidates: EvaluatedCandidateRow[];
  queueAgeMs: number | null;
  window: PageWindow;
  /**
   * candidateId -> productId for this page's candidates already drafted into
   * the catalogue. Queried only on the two tabs that offer "Add to Product
   * Catalogue" (one extra statement there); empty everywhere else.
   */
  inCatalogue: ReadonlyMap<string, string>;
};

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function listTabRows(
  sellerAccountId: string,
  tab: PipelineTab,
  window: PageWindow,
  search: string,
): Promise<EvaluatedCandidateRow[]> {
  const options = {
    limit: window.pageSize,
    offset: window.offset,
    search,
  };

  switch (tab) {
    case 'evaluating':
      // Includes a technical evaluation failure still under its automatic
      // retry cap - see `listEvaluatingCandidates`'s own doc comment for why
      // a plain QUEUED/EVALUATING status filter used to let that row
      // disappear from every tab.
      return listEvaluatingCandidates(sellerAccountId, options);
    case 'exception':
      return listDeadLetteredEvaluations(sellerAccountId, options);
    default:
      return listCandidatesByStatus(
        sellerAccountId,
        [...TAB_STATUSES[tab]],
        options,
      );
  }
}

/**
 * Rows matching a search across the WHOLE tab, not just the page in view.
 * Only called when a search is active: with an empty search the tab's total
 * is already in the count summary the tab bar needs anyway, so the default
 * view spends no extra query on it.
 */
function countTabRows(
  sellerAccountId: string,
  tab: PipelineTab,
  search: string,
): Promise<number> {
  switch (tab) {
    case 'evaluating':
      return countEvaluatingCandidates(sellerAccountId, search);
    case 'exception':
      return countDeadLetteredEvaluations(sellerAccountId, search);
    default:
      return countCandidatesByStatus(
        sellerAccountId,
        [...TAB_STATUSES[tab]],
        search,
      );
  }
}

/** Built per call, never a shared constant - the caller owns the array it gets back. */
function emptyPage(): PipelinePageData {
  return {
    counts: null,
    candidates: [],
    queueAgeMs: null,
    window: resolvePageWindow(0, 1, PIPELINE_PAGE_SIZE),
    inCatalogue: new Map(),
  };
}

/**
 * One page of one tab, plus the counts the tab bar and pagination need.
 *
 * A read failure degrades the whole screen to "nothing resolvable" rather
 * than a half-populated table: the seller sees the tab's empty state and the
 * cause is logged server-side, never rendered.
 */
export default async function resolvePipelinePageData(
  sellerAccountId: string,
  tab: PipelineTab,
  input: { search: string; requestedPage: number },
): Promise<PipelinePageData> {
  const { search, requestedPage } = input;

  try {
    // Page 1 needs no clamping - its offset is 0 whatever the total turns
    // out to be - so the default view fetches its rows in parallel with the
    // counts instead of waiting for them, keeping today's single round trip.
    const firstPage = resolvePageWindow(0, 1, PIPELINE_PAGE_SIZE);
    const [counts, searchTotal, firstPageRows] = await Promise.all([
      readCandidateStatusCounts(sellerAccountId),
      search === '' ? null : countTabRows(sellerAccountId, tab, search),
      requestedPage === 1
        ? listTabRows(sellerAccountId, tab, firstPage, search)
        : null,
    ]);

    const total = searchTotal ?? countForTab(tab, counts);
    const window = resolvePageWindow(total, requestedPage, PIPELINE_PAGE_SIZE);
    const [candidates, queueAgeMs] = await Promise.all([
      firstPageRows ?? listTabRows(sellerAccountId, tab, window, search),
      tab === 'exception' ? oldestQueuedAgeMs(sellerAccountId) : null,
    ]);

    // Ids straight out of the tenant-scoped candidate query, so the global
    // provenance table is only ever probed with this seller's own candidates.
    const inCatalogue =
      tab === 'ready' || tab === 'needs-attention'
        ? new Map(
            (
              await listCandidateIdsWithProducts(
                getDb(),
                candidates.map((candidate) => candidate.candidateId),
              )
            ).map((row) => [row.sourceCandidateId, row.productId]),
          )
        : new Map<string, string>();

    return { counts, candidates, queueAgeMs, window, inCatalogue };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      '[portal] CJ pipeline lookup failed',
      safeErrorMessage(error),
    );

    return emptyPage();
  }
}
