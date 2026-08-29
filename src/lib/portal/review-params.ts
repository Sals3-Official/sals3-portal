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
  /** Sold tab: a relative window (`30d`) or `custom` when `from`/`to` are set. */
  range?: string;
  /** Sold tab: inclusive `YYYY-MM-DD` bounds. Present values beat `range`. */
  from?: string;
  to?: string;
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

/**
 * The Sold tab's date window.
 *
 * Two shapes, because they answer different questions. A **relative** window
 * (`?range=30d`) is what a seller checking in wants, and it stays true when the
 * link is opened next week. An **absolute** window (`?from=&to=`) is what
 * someone reconciling a month wants, and it must not drift. Presets that baked
 * today's date into the URL would quietly turn into the wrong month.
 *
 * `from`/`to` win when both parse, so a hand-edited URL carrying both keys
 * cannot render one window while the control shows another.
 *
 * Parsing is total, like everything else here: an unknown range, a malformed
 * date, or a reversed pair falls back to the whole history rather than erroring
 * or silently showing nothing.
 */
export const SOLD_RANGE_KEYS = ['30d', '90d', '12m', 'all'] as const;

export type SoldRangeKey = (typeof SOLD_RANGE_KEYS)[number];

export type SoldRange = {
  /** `custom` whenever explicit bounds are in play. */
  key: SoldRangeKey | 'custom';
  /** Inclusive lower bound, or `null` for "since the beginning". */
  from: Date | null;
  /** Exclusive upper bound, or `null` for "up to now". */
  to: Date | null;
  /** Echoed back so a control can repopulate its inputs. */
  fromInput: string;
  toInput: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value: string | undefined): Date | null {
  if (value === undefined || !ISO_DATE.test(value)) return null;

  // `Date.parse` on a bare `YYYY-MM-DD` is UTC midnight, which is what the
  // comparison below wants. A malformed-but-matching string ("2026-13-45")
  // still yields NaN, so the guard has to stay.
  const parsed = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Days back for each relative window. `all` has no bound. */
const RANGE_DAYS: Record<Exclude<SoldRangeKey, 'all'>, number> = {
  '30d': 30,
  '90d': 90,
  '12m': 365,
};

export function parseSoldRange(
  params: ReviewSearchParams,
  now: Date,
): SoldRange {
  const from = parseIsoDate(params.from);
  const to = parseIsoDate(params.to);

  if (from !== null && to !== null && from.getTime() <= to.getTime()) {
    // The upper bound is exclusive, so a `to` of the 5th has to reach the end
    // of the 5th or every order placed that day is silently dropped — the kind
    // of off-by-one a seller only catches when a total looks wrong.
    const exclusiveTo = new Date(to.getTime() + 24 * 60 * 60 * 1000);

    return {
      key: 'custom',
      from,
      to: exclusiveTo,
      fromInput: params.from ?? '',
      toInput: params.to ?? '',
    };
  }

  const key = (SOLD_RANGE_KEYS as readonly string[]).includes(
    params.range ?? '',
  )
    ? (params.range as SoldRangeKey)
    : 'all';

  if (key === 'all') {
    return { key, from: null, to: null, fromInput: '', toInput: '' };
  }

  const days = RANGE_DAYS[key];

  return {
    key,
    from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    to: null,
    fromInput: '',
    toInput: '',
  };
}

/** Human label for the active window, for the band and the export filename. */
export function soldRangeLabel(range: SoldRange): string {
  if (range.key === 'custom') return `${range.fromInput} to ${range.toInput}`;
  if (range.key === '30d') return 'Last 30 days';
  if (range.key === '90d') return 'Last 90 days';
  if (range.key === '12m') return 'Last 12 months';

  return 'All time';
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
