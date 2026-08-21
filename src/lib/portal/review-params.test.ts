// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildReviewQuery, parseReviewView } from './review-params';

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
