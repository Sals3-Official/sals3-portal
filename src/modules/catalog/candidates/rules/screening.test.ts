import { describe, expect, it } from 'vitest';
import type { FeedSnapshot } from './contracts';
import {
  checkCounterfeitSignalCheap,
  checkPriceBoundsCheap,
  checkProhibitedCategory,
  runScreening,
} from './screening';

function feed(overrides: Partial<FeedSnapshot>): FeedSnapshot {
  return {
    name: 'Plain phone case',
    category: 'Phone accessories',
    priceUsdCents: 500,
    listedCount: 10,
    shipsFrom: ['CN'],
    ...overrides,
  };
}

describe('checkProhibitedCategory', () => {
  it('blocks a category matching the spec 14.1 exclusion list', () => {
    const result = checkProhibitedCategory(
      feed({ category: 'Tobacco accessories' }),
    );

    expect(result).toMatchObject({
      reasonCode: 'POLICY_BLOCKED',
      severity: 'BLOCK',
    });
  });

  it('blocks when the product name itself matches, even with a clean category', () => {
    const result = checkProhibitedCategory(
      feed({ name: 'Rechargeable battery pack' }),
    );

    expect(result).toMatchObject({
      reasonCode: 'POLICY_BLOCKED',
      severity: 'BLOCK',
    });
  });

  it('passes a clean category and name', () => {
    expect(checkProhibitedCategory(feed({}))).toBeNull();
  });
});

describe('checkCounterfeitSignalCheap', () => {
  it('blocks an exact protected-brand match', () => {
    const result = checkCounterfeitSignalCheap(
      feed({ name: 'Nike running shoes' }),
    );

    expect(result).toMatchObject({
      reasonCode: 'COUNTERFEIT_HIGH_CONFIDENCE',
      severity: 'BLOCK',
    });
  });

  it('flags a weaker signal as attention only, never blocked', () => {
    const result = checkCounterfeitSignalCheap(
      feed({ name: 'AAA quality replica watch' }),
    );

    expect(result).toMatchObject({
      reasonCode: 'COUNTERFEIT_HIGH_CONFIDENCE',
      severity: 'ATTENTION',
    });
  });

  it('never claims authenticity for an unmatched name', () => {
    expect(checkCounterfeitSignalCheap(feed({}))).toBeNull();
  });
});

describe('checkPriceBoundsCheap', () => {
  it('blocks a price below the placeholder minimum', () => {
    const result = checkPriceBoundsCheap(feed({ priceUsdCents: 1 }));

    expect(result).toMatchObject({
      reasonCode: 'INVALID_PRICE',
      severity: 'BLOCK',
    });
  });

  it('blocks a price above the placeholder maximum', () => {
    const result = checkPriceBoundsCheap(feed({ priceUsdCents: 10_000_000 }));

    expect(result).toMatchObject({
      reasonCode: 'INVALID_PRICE',
      severity: 'BLOCK',
    });
  });

  it('flags a missing price as attention, not a fabricated pass', () => {
    const result = checkPriceBoundsCheap(feed({ priceUsdCents: null }));

    expect(result).toMatchObject({
      reasonCode: 'INSUFFICIENT_PRODUCT_DATA',
      severity: 'ATTENTION',
    });
  });

  it('passes a price within bounds', () => {
    expect(checkPriceBoundsCheap(feed({}))).toBeNull();
  });
});

describe('runScreening', () => {
  it('returns no findings for a clean feed row', () => {
    expect(runScreening(feed({}))).toEqual([]);
  });

  it('combines every check, surfacing one finding per triggered rule', () => {
    const findings = runScreening(
      feed({ category: 'Tobacco', priceUsdCents: -1 }),
    );

    expect(findings.map((finding) => finding.reasonCode).sort()).toEqual(
      ['INVALID_PRICE', 'POLICY_BLOCKED'].sort(),
    );
  });
});
