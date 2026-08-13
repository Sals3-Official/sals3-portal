import { describe, expect, it } from 'vitest';
import {
  candidateSlugsFromTitle,
  isPublicSlug,
  slugBaseFromTitle,
} from './slug';

const PRODUCT_ID = '90a329b9-56aa-4f54-abb2-ad843602aa73';

describe('isPublicSlug', () => {
  it.each([
    ['waterproof-shell-jacket', true],
    ['a1', true],
    ['Not-A-Slug', false],
    ['double--hyphen', false],
    ['-leading', false],
    ['trailing-', false],
    ['has space', false],
    ['', false],
    ['a'.repeat(81), false],
  ])('%j -> %s', (value, expected) => {
    expect(isPublicSlug(value)).toBe(expected);
  });
});

describe('slugBaseFromTitle', () => {
  it('lowercases and collapses non-alphanumeric runs', () => {
    expect(
      slugBaseFromTitle("Men's Short-Style Cold-Weather Waterproof Shell"),
    ).toBe('men-s-short-style-cold-weather-waterproof-shell');
  });

  it('truncates on a hyphen boundary rather than mid-word', () => {
    const base = slugBaseFromTitle(
      'super comfortable extremely warm double sided polar fleece jacket for cold winter mornings',
    );

    expect(base.length).toBeLessThanOrEqual(80);
    expect(base.endsWith('-')).toBe(false);
    expect(isPublicSlug(base)).toBe(true);
  });

  it('returns an empty base when nothing survives normalisation', () => {
    expect(slugBaseFromTitle('男士夹克')).toBe('');
    expect(slugBaseFromTitle('!!! ???')).toBe('');
  });
});

describe('candidateSlugsFromTitle', () => {
  it('offers the base slug first, then numbered, then an id-suffixed fallback', () => {
    const slugs = candidateSlugsFromTitle(
      'Waterproof Shell Jacket',
      PRODUCT_ID,
    );

    expect(slugs[0]).toBe('waterproof-shell-jacket');
    expect(slugs[1]).toBe('waterproof-shell-jacket-2');
    expect(slugs[slugs.length - 1]).toBe('waterproof-shell-jacket-90a329b9');
  });

  it('every candidate satisfies the consumer regex', () => {
    const titles = [
      'Waterproof Shell Jacket',
      "Men's  Retro   Fleece — Lined Collar",
      'A',
      'super comfortable extremely warm double sided polar fleece jacket for cold winter mornings',
    ];

    titles.forEach((title) => {
      const slugs = candidateSlugsFromTitle(title, PRODUCT_ID);

      expect(slugs.length).toBeGreaterThan(0);
      slugs.forEach((slug) => {
        expect(isPublicSlug(slug)).toBe(true);
      });
    });
  });

  /**
   * The guaranteed-unique last candidate is what stops the ladder being
   * exhausted by a common title. Budgeting the suffix — rather than appending
   * and hoping — is what keeps it inside the length cap.
   */
  it('keeps the id-suffixed candidate within the length cap', () => {
    const slugs = candidateSlugsFromTitle('x'.repeat(200), PRODUCT_ID);
    const last = slugs[slugs.length - 1];

    expect(last).toContain('90a329b9');
    expect(isPublicSlug(last)).toBe(true);
  });

  it('falls back to a stable id-based slug for a title with no usable characters', () => {
    expect(candidateSlugsFromTitle('男士夹克', PRODUCT_ID)).toEqual([
      'product-90a329b9',
    ]);
  });

  it('never emits a bare shared slug two products would fight over', () => {
    const first = candidateSlugsFromTitle('!!!', PRODUCT_ID);
    const second = candidateSlugsFromTitle(
      '!!!',
      'c2d21725-04af-40aa-9a6f-820fdaf97762',
    );

    expect(first).not.toEqual(second);
    expect(first).not.toContain('product');
  });
});
