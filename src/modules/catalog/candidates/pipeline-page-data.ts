import { countForTab, type PipelineTab } from '@/lib/portal/pipeline-tabs';
import { resolvePageWindow, type PageWindow } from '@/lib/portal/pagination';
import {
  countCandidatesByStatus,
  countDeadLetteredEvaluations,
  countEvaluatingCandidates,
  listCandidatesByStatus,
  listDeadLetteredEvaluations,
  listEvaluatingCandidates,
  oldestQueuedAgeMs,
  PIPELINE_PAGE_SIZE,
  type CandidateFilters,
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
};

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Filters apply to the two tabs that share `listCandidatesByStatus` — Ready
 * and Needs Attention, the screens a seller actually sources from. The other
 * three tabs are served by their own queries with their own scopes, so handing
 * them a filter would either be ignored (a control that does nothing) or need
 * a second implementation of the same predicate. The filter bar renders only
 * where the filter is real; this is the server half of that same rule.
 */
function tabAcceptsFilters(tab: PipelineTab): boolean {
  return tab === 'ready' || tab === 'needs-attention';
}

function listTabRows(
  sellerAccountId: string,
  tab: PipelineTab,
  window: PageWindow,
  search: string,
  filters: CandidateFilters | undefined,
  fuzzy: boolean,
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
      return listCandidatesByStatus(sellerAccountId, [...TAB_STATUSES[tab]], {
        ...options,
        filters: tabAcceptsFilters(tab) ? filters : undefined,
        fuzzy,
      });
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
  filters: CandidateFilters | undefined,
  fuzzy: boolean,
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
        tabAcceptsFilters(tab) ? filters : undefined,
        fuzzy,
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
  input: {
    search: string;
    requestedPage: number;
    /** Applied in SQL for Ready and Needs Attention — see `tabAcceptsFilters`. */
    filters?: CandidateFilters;
    /** Whether this database has `pg_trgm`, so the search may match a typo. */
    fuzzy?: boolean;
  },
): Promise<PipelinePageData> {
  const { search, requestedPage } = input;
  const filters = tabAcceptsFilters(tab) ? input.filters : undefined;
  const fuzzy = input.fuzzy ?? false;
  /*
    A filtered tab's total is NOT the tab's own count. `countForTab` reads the
    cached status summary, which knows nothing about a category or a freshness
    predicate — using it would page a 12-row filtered result as if it held
    432,654, and every page past the first would render empty under a paginator
    claiming thousands. Filters therefore cost the same extra count query that
    a search already does, and for the same reason.
  */
  const needsCount = search !== '' || filters !== undefined;

  try {
    // Page 1 needs no clamping - its offset is 0 whatever the total turns
    // out to be - so the default view fetches its rows in parallel with the
    // counts instead of waiting for them, keeping today's single round trip.
    const firstPage = resolvePageWindow(0, 1, PIPELINE_PAGE_SIZE);
    const [counts, scopedTotal, firstPageRows] = await Promise.all([
      readCandidateStatusCounts(sellerAccountId),
      needsCount
        ? countTabRows(sellerAccountId, tab, search, filters, fuzzy)
        : null,
      requestedPage === 1
        ? listTabRows(sellerAccountId, tab, firstPage, search, filters, fuzzy)
        : null,
    ]);

    const total = scopedTotal ?? countForTab(tab, counts);
    const window = resolvePageWindow(total, requestedPage, PIPELINE_PAGE_SIZE);
    const [candidates, queueAgeMs] = await Promise.all([
      firstPageRows ??
        listTabRows(sellerAccountId, tab, window, search, filters, fuzzy),
      tab === 'exception' ? oldestQueuedAgeMs(sellerAccountId) : null,
    ]);

    return { counts, candidates, queueAgeMs, window };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      '[portal] CJ pipeline lookup failed',
      safeErrorMessage(error),
    );

    return emptyPage();
  }
}
