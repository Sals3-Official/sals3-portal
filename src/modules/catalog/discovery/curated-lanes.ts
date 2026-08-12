import type { CuratedPageQuery } from '@/modules/suppliers/contracts';
import type { CuratedLane, DiscoverySignal } from '@/lib/db/schema';
import { CURATED_HIGH_LISTED_MIN, CURATED_PAGE_SIZE } from './config';
import formatCjCreateTime from './time-format';

/**
 * The owner-approved curated CJ discovery lanes (2026-08-12).
 *
 * Each is a bounded, ranked SUBSET of the CJ catalogue read through the same
 * legacy `GET /api2.0/v1/product/list` endpoint the canonical scanner uses.
 * They add useful supplier signals; they never add a coverage, stock,
 * eligibility, or profitability claim, and they never mark a partition,
 * cycle, or catalogue complete.
 *
 * DELIBERATELY NOT IMPLEMENTED: a second `CJ Trending - more`
 * (`searchType=21`) lane. The turnover authorized it only "if CJ's actual
 * response contract supports a distinct continuation/result set", and no
 * primary source in this workspace establishes that, nor may this task make
 * a live CJ call to find out. Creating it anyway would produce a duplicate
 * pseudo-lane that double-reports the same products as a second signal - so
 * it is left out until the contract is verified. See the completion report.
 */

export type CuratedLaneDefinition = {
  lane: CuratedLane;
  /** Seller-facing quick-view/filter label. */
  label: string;
  /** Signals a product observed in this lane receives. */
  signals: DiscoverySignal[];
  /**
   * Redacted description of the provider query, persisted alongside each
   * observation. Filters only - never a token, credential, or full URL.
   */
  describeQuery(query: CuratedPageQuery): string;
  buildQuery(input: {
    pageNum: number;
    windowFromMs: number | null;
    windowToMs: number | null;
  }): CuratedPageQuery;
};

/**
 * `listedNum` is CJ's count of platform LISTINGS, not units sold, orders, or
 * buyers. `CJ_HIGH_LISTED` therefore records a ranking observation above a
 * configured display threshold and must never be read as demand evidence.
 */
export function highListedApplies(listedCount: number | null): boolean {
  return listedCount !== null && listedCount >= CURATED_HIGH_LISTED_MIN;
}

const TRENDING: CuratedLaneDefinition = {
  lane: 'CJ_TRENDING',
  label: 'CJ Trending',
  signals: ['CJ_TRENDING'],
  describeQuery: (query) =>
    `product/list searchType=${query.searchType} pageSize=${query.pageSize}`,
  buildQuery: ({ pageNum }) => ({
    pageNum,
    pageSize: CURATED_PAGE_SIZE,
    // Owner-specified CJ curated-set selector.
    searchType: 2,
  }),
};

const MOST_LISTED: CuratedLaneDefinition = {
  lane: 'CJ_MOST_LISTED',
  label: 'Most listed on CJ',
  signals: ['CJ_HIGH_LISTED'],
  describeQuery: (query) =>
    `product/list orderBy=${query.orderBy} sort=${query.sort} pageSize=${query.pageSize}`,
  buildQuery: ({ pageNum }) => ({
    pageNum,
    pageSize: CURATED_PAGE_SIZE,
    orderBy: 'listedNum',
    // Fixed direction so repeated runs walk the same deterministic sequence.
    sort: 'desc',
  }),
};

const NEW_ARRIVALS: CuratedLaneDefinition = {
  lane: 'CJ_NEW_ARRIVALS',
  label: 'New arrivals',
  signals: ['CJ_NEW_ARRIVAL'],
  describeQuery: (query) =>
    `product/list orderBy=${query.orderBy} sort=${query.sort} createTimeFrom=${query.createTimeFrom ?? '-'} createTimeTo=${query.createTimeTo ?? '-'}`,
  buildQuery: ({ pageNum, windowFromMs, windowToMs }) => ({
    pageNum,
    pageSize: CURATED_PAGE_SIZE,
    orderBy: 'createAt',
    // Fixed deterministic direction; newest first is what the view promises.
    sort: 'desc',
    ...(windowFromMs === null
      ? {}
      : { createTimeFrom: formatCjCreateTime(windowFromMs) }),
    ...(windowToMs === null
      ? {}
      : { createTimeTo: formatCjCreateTime(windowToMs) }),
  }),
};

export const CURATED_LANE_DEFINITIONS: Record<
  CuratedLane,
  CuratedLaneDefinition
> = {
  CJ_TRENDING: TRENDING,
  CJ_MOST_LISTED: MOST_LISTED,
  CJ_NEW_ARRIVALS: NEW_ARRIVALS,
};

export const CURATED_LANES: CuratedLane[] = [
  'CJ_TRENDING',
  'CJ_MOST_LISTED',
  'CJ_NEW_ARRIVALS',
];

/**
 * Which signals a product observed in this lane earns. `CJ_MOST_LISTED`
 * grants `CJ_HIGH_LISTED` only above the configured `listedNum` threshold, so
 * a low-listed product ranked highly in a sparse page does not collect a
 * badge its own numbers do not support.
 */
export function signalsForObservation(
  lane: CuratedLane,
  listedCount: number | null,
): DiscoverySignal[] {
  if (lane === 'CJ_MOST_LISTED') {
    return highListedApplies(listedCount) ? ['CJ_HIGH_LISTED'] : [];
  }

  return CURATED_LANE_DEFINITIONS[lane].signals;
}
