import { describe, expect, it } from 'vitest';
import type { BuyerDestinationCountryPolicy } from '@/lib/country-policy/types';
import type { FeedSnapshot } from './contracts';
import {
  checkCounterfeitSignalCheap,
  checkPriceBoundsCheap,
  checkProhibitedCategory,
  checkValidMarket,
  runScreening,
  type MarketValidationInput,
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

function buyerPolicy(
  overrides: Partial<BuyerDestinationCountryPolicy>,
): BuyerDestinationCountryPolicy {
  return {
    countryCodes: [],
    policyVersion: 'test-buyer-destination-v1',
    source: 'test-fixture',
    effective: 'DISABLED',
    ...overrides,
  };
}

function marketInput(
  overrides: Partial<MarketValidationInput>,
): MarketValidationInput {
  return {
    buyerDestinationPolicy: buyerPolicy({}),
    candidateDestinationCodes: [],
    ...overrides,
  };
}

const AU_ENABLED = buyerPolicy({ countryCodes: ['AU'], effective: 'ENABLED' });

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

describe('checkValidMarket', () => {
  it('blocks recoverably when no buyer destination-country policy is enabled yet', () => {
    // No ADR-003 market is approved (ADR-014): every candidate fails closed
    // here regardless of its own data, rather than silently assuming a
    // hardcoded market applied.
    expect(
      checkValidMarket(marketInput({ candidateDestinationCodes: ['AU'] })),
    ).toMatchObject({
      reasonCode: 'NO_VALID_MARKET',
      severity: 'BLOCK',
    });
  });

  it('blocks when the buyer destination policy is enabled but has an empty allowlist', () => {
    expect(
      checkValidMarket(
        marketInput({
          buyerDestinationPolicy: buyerPolicy({
            effective: 'ENABLED',
            countryCodes: [],
          }),
          candidateDestinationCodes: ['AU'],
        }),
      ),
    ).toMatchObject({ reasonCode: 'NO_VALID_MARKET', severity: 'BLOCK' });
  });

  it('blocks a candidate with no intended destination even while a policy is enabled', () => {
    const result = checkValidMarket(
      marketInput({
        buyerDestinationPolicy: AU_ENABLED,
        candidateDestinationCodes: [],
      }),
    );

    expect(result).toMatchObject({
      reasonCode: 'NO_VALID_MARKET',
      severity: 'BLOCK',
    });
    expect(result?.detail).toContain('no intended destination-country code');
  });

  it("blocks a candidate's historical ['PH'] destination under an enabled ['AU'] policy, without rewriting it", () => {
    const candidateDestinationCodes = ['PH'];
    const result = checkValidMarket(
      marketInput({
        buyerDestinationPolicy: AU_ENABLED,
        candidateDestinationCodes,
      }),
    );

    expect(result).toMatchObject({
      reasonCode: 'NO_VALID_MARKET',
      severity: 'BLOCK',
    });
    expect(result?.detail).toContain('PH');
    // The rule only reads the candidate's destinations - it never mutates them.
    expect(candidateDestinationCodes).toEqual(['PH']);
  });

  it("passes a candidate's ['AU'] destination only under an enabled ['AU'] policy", () => {
    expect(
      checkValidMarket(
        marketInput({
          buyerDestinationPolicy: AU_ENABLED,
          candidateDestinationCodes: ['AU'],
        }),
      ),
    ).toBeNull();
  });

  it('blocks mixed candidate destinations when any one of them is not enabled', () => {
    const result = checkValidMarket(
      marketInput({
        buyerDestinationPolicy: AU_ENABLED,
        candidateDestinationCodes: ['AU', 'PH'],
      }),
    );

    expect(result).toMatchObject({
      reasonCode: 'NO_VALID_MARKET',
      severity: 'BLOCK',
    });
    expect(result?.detail).toContain('PH');
  });

  it('passes both destinations under the currently approved AU+PH allowlist', () => {
    // Locks in the live policy shape: a candidate scoped to both approved
    // destinations, and one scoped to a single member of the pair, must both
    // clear the market rule. Anything else means the pilot cohort cannot be
    // evaluated at all.
    const auPhEnabled = buyerPolicy({
      countryCodes: ['AU', 'PH'],
      effective: 'ENABLED',
    });

    expect(
      checkValidMarket(
        marketInput({
          buyerDestinationPolicy: auPhEnabled,
          candidateDestinationCodes: ['AU', 'PH'],
        }),
      ),
    ).toBeNull();
    expect(
      checkValidMarket(
        marketInput({
          buyerDestinationPolicy: auPhEnabled,
          candidateDestinationCodes: ['PH'],
        }),
      ),
    ).toBeNull();

    // An unscoped candidate still blocks under the same enabled policy -
    // this is the guard the pilot's data cap relies on.
    expect(
      checkValidMarket(
        marketInput({
          buyerDestinationPolicy: auPhEnabled,
          candidateDestinationCodes: [],
        }),
      ),
    ).toMatchObject({ reasonCode: 'NO_VALID_MARKET', severity: 'BLOCK' });
  });

  it('does not widen a candidate to a newly enabled country it never asked for', () => {
    // Enabling AU and SG must not retroactively qualify a PH-only candidate.
    expect(
      checkValidMarket(
        marketInput({
          buyerDestinationPolicy: buyerPolicy({
            effective: 'ENABLED',
            countryCodes: ['AU', 'SG'],
          }),
          candidateDestinationCodes: ['PH'],
        }),
      ),
    ).toMatchObject({ reasonCode: 'NO_VALID_MARKET', severity: 'BLOCK' });
  });
});

describe('runScreening', () => {
  it('blocks a clean feed row with NO_VALID_MARKET while no buyer destination is enabled', () => {
    expect(
      runScreening(feed({}), marketInput({})).map(
        (finding) => finding.reasonCode,
      ),
    ).toEqual(['NO_VALID_MARKET']);
  });

  it('passes the market check when the candidate destination matches the enabled policy', () => {
    expect(
      runScreening(
        feed({}),
        marketInput({
          buyerDestinationPolicy: AU_ENABLED,
          candidateDestinationCodes: ['AU'],
        }),
      ),
    ).toEqual([]);
  });

  it('combines every check, surfacing one finding per triggered rule', () => {
    const findings = runScreening(
      feed({ category: 'Tobacco', priceUsdCents: -1 }),
      marketInput({}),
    );

    expect(findings.map((finding) => finding.reasonCode).sort()).toEqual(
      ['INVALID_PRICE', 'NO_VALID_MARKET', 'POLICY_BLOCKED'].sort(),
    );
  });
});
