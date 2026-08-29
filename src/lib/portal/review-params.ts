import type { ReviewRating } from '@/modules/reviews/contracts';
import type { SellerReviewFilter } from '@/modules/reviews/seller-read';

/**
 * URL contract for **Product Reviews** (`/reviews`).
 *
 * Every filter lives in the query string, so a view is shareable, the back
 * button behaves, and "the 1-star ones with no reply" is a link a seller can
 * send to a colleague. Same rule as `pipeline-params.ts`.
 *
 * Parsing is total: a malformed value falls back rather than erroring, because
 * a hand-edited URL is a normal thing for a person to do and a 500 is not a
 * reasonable answer to it.
 */

export const REVIEWS_PAGE_SIZE = 20;

export type ReviewSearchParams = {
  /** Which of the page's two tabs is open. `tab` is already taken by the
      reply-state filter below, so the page-level switch needs its own key. */
  view?: string;
  tab?: string;
  stars?: string;
  q?: string;
  page?: string;
};

export type ReviewView = {
  filter: SellerReviewFilter;
  page: number;
};

const REPLY_STATES = new Set(['needs-reply', 'replied']);

/** The page's two tabs. Reviews is the default and carries no query key. */
export type ReviewsTab = 'reviews' | 'sold';

/**
 * Total, like every other parser here: anything that is not exactly `sold`
 * reads as the default tab rather than erroring on a hand-edited URL.
 */
export function parseReviewsTab(params: ReviewSearchParams): ReviewsTab {
  return params.view === 'sold' ? 'sold' : 'reviews';
}

function parseStars(value: string | undefined): ReviewRating[] {
  if (value === undefined || value.trim() === '') return [];

  // Matched, not parsed. `Number.parseInt('4.5')` is 4, so a parse would read
  // a value nobody can mean as a real filter and silently show four-star
  // reviews for it. A star is one of five literal characters or it is nothing.
  const parsed = value
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is `${ReviewRating}` => /^[1-5]$/.test(part))
    .map((part) => Number(part) as ReviewRating);

  // Deduplicated and sorted so `?stars=5,5,4` and `?stars=4,5` are one cache
  // key and one rendered state, not two.
  return Array.from(new Set(parsed)).sort((left, right) => left - right);
}

export function parseReviewView(params: ReviewSearchParams): ReviewView {
  const page = Number.parseInt(params.page ?? '1', 10);

  return {
    filter: {
      replyState:
        params.tab !== undefined && REPLY_STATES.has(params.tab)
          ? (params.tab as 'needs-reply' | 'replied')
          : null,
      ratings: parseStars(params.stars),
      // Bounded before it reaches a query. `ilike` with an unbounded pattern is
      // a scan a URL should not be able to ask for.
      query: (params.q ?? '').trim().slice(0, 80),
    },
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/**
 * Builds the next URL from the current one, preserving what the caller did not
 * change — and resetting `page` whenever a *filter* moves, because page 7 of a
 * narrower result set is usually empty.
 *
 * That reset is the bug `buildQueryString` had on the sourcing screens: a
 * non-filter patch silently dropped `page`, so paging through a list and then
 * touching anything else jumped back to the start. Here the rule is explicit
 * and stated in one place.
 */
export function buildReviewQuery(
  current: ReviewSearchParams,
  patch: Partial<ReviewSearchParams>,
): string {
  const merged = { ...current, ...patch };
  const changesFilter = 'tab' in patch || 'stars' in patch || 'q' in patch;
  const search = new URLSearchParams();

  if (merged.tab !== undefined && REPLY_STATES.has(merged.tab)) {
    search.set('tab', merged.tab);
  }

  if (merged.stars !== undefined && merged.stars !== '') {
    search.set('stars', merged.stars);
  }

  if (merged.q !== undefined && merged.q.trim() !== '') {
    search.set('q', merged.q.trim());
  }

  const page = changesFilter ? '1' : (merged.page ?? '1');

  if (page !== '1') search.set('page', page);

  const query = search.toString();

  return query === '' ? '/reviews' : `/reviews?${query}`;
}
