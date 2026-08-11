import { describe, expect, it } from 'vitest';
import type { SellerMarketProfileRow } from '@/lib/db/schema';
import type { MarketDestinationCapability } from '@/modules/market-config/capabilities';
import {
  capabilityLabel,
  describeProfileStatus,
  describeSellingCurrency,
  listSetupCandidates,
} from './market-profile-view';

const AU: MarketDestinationCapability = {
  destinationCountryCode: 'AU',
  destinationName: 'Australia',
  readiness: 'BOUNDED_PILOT',
  authorizedSellingCurrencyCodes: [],
  pendingCapabilities: ['PAYMENTS', 'LOGISTICS', 'TAX', 'PAYOUT'],
};

const PH: MarketDestinationCapability = {
  ...AU,
  destinationCountryCode: 'PH',
  destinationName: 'Philippines',
};

function profile(
  overrides: Partial<SellerMarketProfileRow>,
): SellerMarketProfileRow {
  return {
    id: 'profile-1',
    sellerAccountId: 'seller-a',
    destinationCountryCode: 'AU',
    sellingCurrencyCode: null,
    locale: null,
    timeZone: null,
    status: 'DRAFT',
    version: 1,
    capabilityVersion: 'v1',
    source: 'owner-instruction',
    reason: 'Opening this destination for the bounded pilot.',
    actorId: 'user-1',
    activatedAt: null,
    suspendedAt: null,
    createdAt: new Date('2026-08-12T00:00:00Z'),
    updatedAt: new Date('2026-08-12T00:00:00Z'),
    ...overrides,
  };
}

describe('describeProfileStatus', () => {
  it('distinguishes a draft from an active profile', () => {
    expect(describeProfileStatus('DRAFT', 4).label).toBe('Pending setup');
    expect(describeProfileStatus('ACTIVE', 0).label).toBe('Active');
  });

  it('never calls an active pilot destination a finished market', () => {
    const description = describeProfileStatus('ACTIVE', 4);

    expect(description.label).toContain('capabilities incomplete');
    expect(description.detail).toContain('not a launched market');
  });

  it('describes a suspended profile as re-configurable', () => {
    const description = describeProfileStatus('SUSPENDED', 4);

    expect(description.label).toBe('Suspended');
    expect(description.tone).toBe('warning');
  });

  it('only reports a plain Active state when nothing is outstanding', () => {
    expect(describeProfileStatus('ACTIVE', 0).tone).toBe('positive');
    expect(describeProfileStatus('ACTIVE', 1).tone).toBe('progress');
  });
});

describe('listSetupCandidates', () => {
  it('offers every approved destination when nothing is configured', () => {
    expect(listSetupCandidates([], [AU, PH])).toEqual([AU, PH]);
  });

  it('hides a destination that is already a draft or active', () => {
    const drafted = profile({ destinationCountryCode: 'AU' });
    const active = profile({
      id: 'profile-2',
      destinationCountryCode: 'PH',
      status: 'ACTIVE',
    });

    expect(listSetupCandidates([drafted, active], [AU, PH])).toEqual([]);
  });

  it('offers a suspended destination again', () => {
    const suspended = profile({
      destinationCountryCode: 'AU',
      status: 'SUSPENDED',
    });

    expect(
      listSetupCandidates([suspended], [AU, PH]).map(
        (d) => d.destinationCountryCode,
      ),
    ).toEqual(['AU', 'PH']);
  });

  it('never offers a destination outside the approved list', () => {
    const capabilities = [AU, PH];

    expect(
      listSetupCandidates([], capabilities).map(
        (d) => d.destinationCountryCode,
      ),
    ).not.toContain('SG');
  });
});

describe('describeSellingCurrency', () => {
  it('reports absence rather than substituting the portal reference currency', () => {
    expect(describeSellingCurrency(profile({}))).toBeNull();
  });

  it('reports a currency once one is actually stored', () => {
    expect(
      describeSellingCurrency(profile({ sellingCurrencyCode: 'AUD' })),
    ).toBe('AUD');
  });
});

describe('capabilityLabel', () => {
  it('gives each outstanding capability a readable name', () => {
    expect(capabilityLabel('LOGISTICS')).toBe('Logistics & freight');
  });

  it('falls back to the raw code rather than inventing a label', () => {
    expect(capabilityLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
