// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// `category-trail.ts` is `server-only`, which throws on import outside a Server
// Component — it carries the 5,595-row taxonomy extract that must never reach a
// browser bundle. The guard is doing its job; these are pure functions inside
// that module, so this test stands the guard down rather than weakening it.
// Same convention as `variation-families.test.ts`.
vi.mock('server-only', () => ({}));

/* eslint-disable import/first */
import {
  categoryTrailForPath,
  taxonomyCodeFromSlug,
  taxonomyPathForCode,
} from './category-trail';
/* eslint-enable import/first */

/**
 * The real path from the live `Cash Savings Book` PDP, read off production on
 * 2026-08-31. Four levels, of which only the first was a link — the other three
 * were plain text on every product page in the catalogue.
 */
const BOOK_PATH =
  'Office Supplies > General Office Supplies > Paper Products > Notebooks & Notepads';

describe('categoryTrailForPath', () => {
  it('makes every level of the real four-level path addressable', () => {
    expect(categoryTrailForPath(BOOK_PATH)).toEqual([
      // L1 keeps its bare department slug: already live, already linked from
      // four surfaces, and Google has indexed it.
      { name: 'Office Supplies', slug: 'office-supplies' },
      {
        name: 'General Office Supplies',
        slug: 'general-office-supplies-932',
      },
      { name: 'Paper Products', slug: 'paper-products-956' },
      { name: 'Notebooks & Notepads', slug: 'notebooks-notepads-961' },
    ]);
  });

  it('resolves each ancestor by its own path, not by its leaf name', () => {
    // `Paper Products` appears once here, but a leaf name is not unique across
    // 5,595 rows in general — the id has to come from the row whose *full* path
    // ends at that level.
    const trail = categoryTrailForPath(BOOK_PATH);
    const paperProducts = trail[2];

    expect(taxonomyPathForCode('CAT-GGL-956')).toBe(
      'Office Supplies > General Office Supplies > Paper Products',
    );
    expect(paperProducts?.slug).toBe('paper-products-956');
  });

  it('leaves a CJ-mirrored path unaddressable rather than pointing at a 404', () => {
    // Minted at runtime, never seeded, so it is absent from the extract by
    // construction — and those rows put a whole supplier path in `l1` anyway.
    const trail = categoryTrailForPath('Men Clothing > Pants > Wide Leg Jeans');

    expect(trail.map((entry) => entry.name)).toEqual([
      'Men Clothing',
      'Pants',
      'Wide Leg Jeans',
    ]);
    expect(trail.every((entry) => entry.slug === undefined)).toBe(true);
  });

  it('addresses a bare department path with no id at all', () => {
    expect(categoryTrailForPath('Apparel & Accessories')).toEqual([
      { name: 'Apparel & Accessories', slug: 'apparel-accessories' },
    ]);
  });

  it('drops empty segments rather than emitting a blank level', () => {
    expect(
      categoryTrailForPath(' Office Supplies >  > Paper Products > '),
    ).toHaveLength(2);
  });

  it('resolves a deep apparel path, the shape the jeans PDP shows', () => {
    const trail = categoryTrailForPath(
      'Apparel & Accessories > Clothing > Pants',
    );

    // `Clothing` and `Pants` both answered 404 before this: they were real
    // taxonomy levels with no address.
    expect(trail.map((entry) => entry.slug)).toEqual([
      'apparel-accessories',
      'clothing-1604',
      'pants-204',
    ]);
  });
});

describe('taxonomyCodeFromSlug', () => {
  it('reads only the trailing id, so the words are decoration', () => {
    expect(taxonomyCodeFromSlug('paper-products-956')).toBe('CAT-GGL-956');
    // A renamed category, or a hand-typed link with the wrong words, still
    // resolves. That is the whole reason the id is in the slug.
    expect(taxonomyCodeFromSlug('completely-wrong-words-956')).toBe(
      'CAT-GGL-956',
    );
  });

  it('refuses an id the taxonomy does not have', () => {
    // Checked against the extract rather than accepted on shape, so an invented
    // id answers "no such category" here instead of reaching a query.
    expect(taxonomyCodeFromSlug('made-up-99999999')).toBe(null);
  });

  it('refuses a bare department slug, leaving it to the department list', () => {
    expect(taxonomyCodeFromSlug('office-supplies')).toBe(null);
    expect(taxonomyCodeFromSlug('apparel-accessories')).toBe(null);
  });

  it('refuses a bare number, which names no subject', () => {
    // Accepting `/c/961` would give every category a second address and gain
    // nothing readable.
    expect(taxonomyCodeFromSlug('961')).toBe(null);
    expect(taxonomyCodeFromSlug('-961')).toBe(null);
  });

  it('refuses the shapes a hostile path segment can take', () => {
    expect(taxonomyCodeFromSlug('')).toBe(null);
    expect(taxonomyCodeFromSlug('paper-products-')).toBe(null);
    expect(taxonomyCodeFromSlug('paper-products-9x6')).toBe(null);
  });
});

describe('taxonomyPathForCode', () => {
  it('answers the full path, which is what a subtree filter needs', () => {
    expect(taxonomyPathForCode('CAT-GGL-961')).toBe(
      'Office Supplies > General Office Supplies > Paper Products > Notebooks & Notepads',
    );
  });

  it('answers null for a code the taxonomy does not carry', () => {
    expect(taxonomyPathForCode('CAT-GGL-99999999')).toBe(null);
    expect(taxonomyPathForCode('CJ-1ae8d0c2')).toBe(null);
  });
});
