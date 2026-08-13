import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { buyerDestinationPolicyMock } = vi.hoisted(() => ({
  buyerDestinationPolicyMock: vi.fn(),
}));

vi.mock('@/lib/country-policy/buyer-destination-country', () => ({
  default: buyerDestinationPolicyMock,
}));

/* eslint-disable import/first */
import {
  findAuthorizedDestination,
  isAuthorizedSellingCurrency,
  resolveSellerMarketCapabilities,
} from './capabilities';

const AU_PH_ENABLED = {
  countryCodes: ['AU', 'PH'],
  policyVersion: 'buyer-destination-country-v2-au-ph',
  source: 'owner-instruction-2026-08-11-au-ph',
  effective: 'ENABLED' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  buyerDestinationPolicyMock.mockReturnValue(AU_PH_ENABLED);
});

describe('resolveSellerMarketCapabilities', () => {
  it('offers exactly the pilot destinations the global policy permits', () => {
    const capabilities = resolveSellerMarketCapabilities();

    expect(
      capabilities.destinations.map((d) => d.destinationCountryCode),
    ).toEqual(['AU', 'PH']);
  });

  it('carries a version so a stored profile can be audited against what approved it', () => {
    expect(resolveSellerMarketCapabilities().capabilityVersion).toBe(
      'seller-market-capability-v2-au-ph-usd-publishable',
    );
  });

  it('never claims a destination is a complete commercial market', () => {
    const capabilities = resolveSellerMarketCapabilities();

    capabilities.destinations.forEach((destination) => {
      expect(destination.readiness).toBe('BOUNDED_PILOT');
      expect(destination.pendingCapabilities).toEqual(
        expect.arrayContaining(['PAYMENTS', 'LOGISTICS', 'TAX', 'PAYOUT']),
      );
    });
  });

  it('authorizes only ADR-003 phase-1 USD, rather than inventing one per country', () => {
    // AUD is the portal's reference/display currency and PHP is nothing at
    // all here — neither is an approved per-destination selling currency, and
    // `reference-fx.ts` cannot even produce a non-USD price today.
    resolveSellerMarketCapabilities().destinations.forEach((destination) => {
      expect(destination.authorizedSellingCurrencyCodes).toEqual(['USD']);
    });
  });

  it('narrows automatically when the global policy narrows', () => {
    buyerDestinationPolicyMock.mockReturnValue({
      ...AU_PH_ENABLED,
      countryCodes: ['PH'],
    });

    expect(
      resolveSellerMarketCapabilities().destinations.map(
        (d) => d.destinationCountryCode,
      ),
    ).toEqual(['PH']);
  });

  it('fails closed when the global policy is disabled', () => {
    buyerDestinationPolicyMock.mockReturnValue({
      ...AU_PH_ENABLED,
      effective: 'DISABLED',
    });

    expect(resolveSellerMarketCapabilities().destinations).toEqual([]);
  });

  it('cannot be widened by the global policy alone', () => {
    // A destination the global policy permits is still not offerable unless
    // this module lists it — widening stays an explicit, versioned edit.
    buyerDestinationPolicyMock.mockReturnValue({
      ...AU_PH_ENABLED,
      countryCodes: ['AU', 'PH', 'SG', 'ID'],
    });

    expect(
      resolveSellerMarketCapabilities().destinations.map(
        (d) => d.destinationCountryCode,
      ),
    ).toEqual(['AU', 'PH']);
  });
});

describe('findAuthorizedDestination', () => {
  it.each(['SG', 'ID', 'US', 'ZZ', 'au', 'ph', '', 'AUSTRALIA'])(
    'rejects %s',
    (code) => {
      expect(findAuthorizedDestination(code)).toBeNull();
    },
  );

  it('accepts an approved pilot destination', () => {
    expect(findAuthorizedDestination('AU')?.destinationName).toBe('Australia');
    expect(findAuthorizedDestination('PH')?.destinationName).toBe(
      'Philippines',
    );
  });

  it('rejects everything once the global policy is disabled', () => {
    buyerDestinationPolicyMock.mockReturnValue({
      ...AU_PH_ENABLED,
      effective: 'DISABLED',
    });

    expect(findAuthorizedDestination('AU')).toBeNull();
  });
});

describe('separation from candidate screening', () => {
  it('is not reachable from the screening rules', () => {
    // Candidate evaluation must keep resolving destinations through the
    // global policy alone. If screening ever read this module, a seller-facing
    // setup change could silently move `candidate_evaluations.policy_version`
    // and requeue historical decisions.
    const screening = readFileSync(
      join(process.cwd(), 'src/modules/catalog/candidates/rules/screening.ts'),
      'utf8',
    );

    expect(screening).not.toContain('market-config/capabilities');
    expect(screening).not.toContain('resolveSellerMarketCapabilities');
    expect(screening).not.toContain('seller_market_profiles');
  });
});

describe('isAuthorizedSellingCurrency', () => {
  it('accepts phase-1 USD and rejects everything else, including AUD and PHP', () => {
    const australia = findAuthorizedDestination('AU');
    expect(australia).not.toBeNull();

    expect(isAuthorizedSellingCurrency(australia!, 'USD')).toBe(true);

    // AUD is the portal's display currency (ADR-014), not an approved selling
    // currency; authorizing it needs an ADR amendment and a real reference-FX
    // provider, not a list edit.
    ['AUD', 'PHP', 'XXX', 'usd'].forEach((code) => {
      expect(isAuthorizedSellingCurrency(australia!, code)).toBe(false);
    });
  });
});
