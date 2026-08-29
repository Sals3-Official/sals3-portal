// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildReviewQuery,
  parseReviewView,
  parseSoldRange,
  soldRangeLabel,
} from './review-params';

describe('parseReviewView', () => {
  it('defaults to every review on page one', () => {
    expect(parseReviewView({})).toEqual({
      filter: { replyState: null, ratings: [], query: '' },
      page: 1,
    });
  });

  it.each(['needs-reply', 'replied'])('accepts the %s tab', (tab) => {
    expect(parseReviewView({ tab }).filter.replyState).toBe(tab);
  });

  /** A hand-edited URL is a normal thing for a person to do, not a 500. */
  it.each(['', 'nonsense', 'NEEDS-REPLY'])(
    'falls back to every review for tab %j',
    (tab) => {
      expect(parseReviewView({ tab }).filter.replyState).toBeNull();
    },
  );

  it('parses, sorts and deduplicates stars', () => {
    expect(parseReviewView({ stars: '5,4,5,1' }).filter.ratings).toEqual([
      1, 4, 5,
    ]);
  });

  it.each(['0', '6', '-1', 'five', '4.5', ''])(
    'drops the out-of-range star %j',
    (stars) => {
      expect(parseReviewView({ stars }).filter.ratings).toEqual([]);
    },
  );

  /** `ilike` with an unbounded pattern is a scan a URL must not be able to ask for. */
  it('bounds the search text', () => {
    const view = parseReviewView({ q: 'x'.repeat(500) });

    expect(view.filter.query).toHaveLength(80);
  });

  it('trims the search text', () => {
    expect(parseReviewView({ q: '  cargo shorts  ' }).filter.query).toBe(
      'cargo shorts',
    );
  });

  it.each(['0', '-3', 'abc', '99999999'])(
    'falls back to page one for %j',
    (page) => {
      expect(parseReviewView({ page }).page).toBe(1);
    },
  );

  it('keeps a real page number', () => {
    expect(parseReviewView({ page: '7' }).page).toBe(7);
  });
});

describe('buildReviewQuery', () => {
  it('omits every default so a clean view is a clean URL', () => {
    expect(buildReviewQuery({}, {})).toBe('/reviews');
  });

  it('preserves what the caller did not change', () => {
    expect(
      buildReviewQuery({ stars: '1,2', q: 'cap' }, { tab: 'replied' }),
    ).toBe('/reviews?tab=replied&stars=1%2C2&q=cap');
  });

  /**
   * The bug `buildQueryString` shipped on the sourcing screens: a non-filter
   * patch silently dropped `page`, so paging then touching anything else jumped
   * back to the start. Paging must survive a patch that is not a filter.
   */
  it('keeps the page when the patch is not a filter', () => {
    expect(buildReviewQuery({ page: '4' }, {})).toBe('/reviews?page=4');
  });

  /** Page 7 of a narrower result set is usually empty, so a filter resets it. */
  it.each([
    ['tab', { tab: 'replied' }],
    ['stars', { stars: '1' }],
    ['q', { q: 'cap' }],
  ])('resets the page when %s moves', (_label, patch) => {
    expect(buildReviewQuery({ page: '4' }, patch)).not.toContain('page=');
  });

  it('drops a filter set back to empty', () => {
    expect(buildReviewQuery({ tab: 'replied', stars: '1' }, { tab: '' })).toBe(
      '/reviews?stars=1',
    );
  });

  it('ignores an unknown tab rather than putting it in the URL', () => {
    expect(buildReviewQuery({}, { tab: 'made-up' })).toBe('/reviews');
  });
});

describe('parseSoldRange', () => {
  const now = new Date('2026-08-30T12:00:00.000Z');

  it('defaults to the whole history', () => {
    const range = parseSoldRange({}, now);

    expect(range.key).toBe('all');
    expect(range.from).toBeNull();
    expect(range.to).toBeNull();
  });

  it('reads a relative window back from the given now', () => {
    const range = parseSoldRange({ range: '30d' }, now);

    expect(range.key).toBe('30d');
    expect(range.from?.toISOString()).toBe('2026-07-31T12:00:00.000Z');
    expect(range.to).toBeNull();
  });

  it('makes an explicit end date inclusive of that whole day', () => {
    const range = parseSoldRange({ from: '2026-08-01', to: '2026-08-05' }, now);

    expect(range.key).toBe('custom');
    expect(range.from?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    // Exclusive upper bound at the following midnight: without this, every
    // order placed on the 5th would be silently dropped from the total.
    expect(range.to?.toISOString()).toBe('2026-08-06T00:00:00.000Z');
  });

  it('lets explicit bounds win over a relative key', () => {
    const range = parseSoldRange(
      { range: '30d', from: '2026-01-01', to: '2026-01-31' },
      now,
    );

    expect(range.key).toBe('custom');
    expect(range.from?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('falls back to the whole history rather than erroring on nonsense', () => {
    expect(parseSoldRange({ range: 'yesterday' }, now).key).toBe('all');
    expect(parseSoldRange({ from: 'soon', to: 'later' }, now).key).toBe('all');
    expect(
      parseSoldRange({ from: '2026-13-45', to: '2026-13-46' }, now).key,
    ).toBe('all');
  });

  it('ignores a reversed pair instead of returning an empty window', () => {
    const range = parseSoldRange({ from: '2026-08-31', to: '2026-08-01' }, now);

    // A backwards range would match no orders at all and read as "you sold
    // nothing", which is a different and false claim.
    expect(range.key).toBe('all');
  });

  it('echoes the inputs back so the control can repopulate', () => {
    const range = parseSoldRange({ from: '2026-08-01', to: '2026-08-05' }, now);

    expect(range.fromInput).toBe('2026-08-01');
    expect(range.toInput).toBe('2026-08-05');
  });
});

describe('soldRangeLabel', () => {
  const now = new Date('2026-08-30T12:00:00.000Z');

  it('names each window the way the export filename will', () => {
    expect(soldRangeLabel(parseSoldRange({}, now))).toBe('All time');
    expect(soldRangeLabel(parseSoldRange({ range: '90d' }, now))).toBe(
      'Last 90 days',
    );
    expect(
      soldRangeLabel(
        parseSoldRange({ from: '2026-08-01', to: '2026-08-05' }, now),
      ),
    ).toBe('2026-08-01 to 2026-08-05');
  });
});
