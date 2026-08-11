import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listProfilesForSellerMock } = vi.hoisted(() => ({
  listProfilesForSellerMock: vi.fn(),
}));

vi.mock('@/modules/market-config/repository', () => ({
  listProfilesForSeller: listProfilesForSellerMock,
}));

vi.mock('@/lib/db/client', () => ({ default: vi.fn(() => ({})) }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/app/(portal)/market-rules/market-profile-actions', () => ({
  beginMarketProfileSetupAction: vi.fn(),
  activateMarketProfileAction: vi.fn(),
  suspendMarketProfileAction: vi.fn(),
}));

/* eslint-disable import/first */
import type { SellerMarketProfileRow } from '@/lib/db/schema';
import MarketProfileSection from './MarketProfileSection';

const SELLER_ID = 'seller-a';

function profile(
  overrides: Partial<SellerMarketProfileRow> = {},
): SellerMarketProfileRow {
  return {
    id: 'profile-1',
    sellerAccountId: SELLER_ID,
    destinationCountryCode: 'AU',
    sellingCurrencyCode: null,
    locale: null,
    timeZone: null,
    status: 'ACTIVE',
    version: 2,
    capabilityVersion: 'seller-market-capability-v1-au-ph-bounded-pilot',
    source: 'owner-instruction-2026-08-11-au-ph-bounded-pilot',
    reason: 'Opening this destination for the bounded pilot.',
    actorId: 'user-1',
    activatedAt: new Date('2026-08-12T00:00:00Z'),
    suspendedAt: null,
    createdAt: new Date('2026-08-12T00:00:00Z'),
    updatedAt: new Date('2026-08-12T00:00:00Z'),
    ...overrides,
  };
}

/** The section is an async server component; render its resolved output. */
async function renderSection(canManage: boolean) {
  const ui = await MarketProfileSection({
    sellerAccountId: SELLER_ID,
    canManage,
  });

  return render(ui);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MarketProfileSection — backend unavailable', () => {
  beforeEach(() => {
    listProfilesForSellerMock.mockRejectedValue(
      new Error('relation "seller_market_profiles" does not exist'),
    );
  });

  it('says the backend could not answer, not that the account is unconfigured', async () => {
    await renderSection(true);

    expect(
      screen.getByText(/Market setup is not available right now/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/not set up for any destination yet/),
    ).not.toBeInTheDocument();
  });

  it('offers no setup control on a failed read, even to an authorized role', async () => {
    await renderSection(true);

    expect(
      screen.queryByRole('button', { name: 'Set up a destination' }),
    ).not.toBeInTheDocument();
  });
});

describe('MarketProfileSection — successful empty read', () => {
  beforeEach(() => {
    listProfilesForSellerMock.mockResolvedValue([]);
  });

  it('shows an account-specific setup state, not a fixture market', async () => {
    await renderSection(true);

    expect(
      screen.getByText(/not set up for any destination yet/),
    ).toBeInTheDocument();

    // None of the illustrative PH/ID/SG fixture ever appears as real config.
    ['Philippines', 'Indonesia', 'Singapore', 'J&T Express', 'GCash'].forEach(
      (fixtureValue) => {
        expect(screen.queryByText(fixtureValue)).not.toBeInTheDocument();
      },
    );
  });

  it('never shows a false active market', async () => {
    await renderSection(true);

    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('offers setup to an authorized role', async () => {
    await renderSection(true);

    expect(
      screen.getByRole('button', { name: 'Set up a destination' }),
    ).toBeInTheDocument();
  });

  it('tells an unauthorized role who can set it up, without a broken control', async () => {
    await renderSection(false);

    expect(
      screen.queryByRole('button', { name: 'Set up a destination' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Ask an account owner/)).toBeInTheDocument();
  });

  it('queries the seller id it was given, never a browser value', async () => {
    await renderSection(true);

    expect(listProfilesForSellerMock).toHaveBeenCalledWith(
      expect.anything(),
      SELLER_ID,
    );
  });
});

describe('MarketProfileSection — configured account', () => {
  it('marks an active pilot destination as incomplete, not launched', async () => {
    listProfilesForSellerMock.mockResolvedValue([profile()]);

    await renderSection(true);

    expect(
      screen.getByText(/Active — pilot, capabilities incomplete/),
    ).toBeInTheDocument();
    expect(screen.getByText(/not a launched market/)).toBeInTheDocument();
  });

  it('names the outstanding capabilities instead of implying they exist', async () => {
    listProfilesForSellerMock.mockResolvedValue([profile()]);

    await renderSection(true);

    expect(screen.getByText('Not yet in place')).toBeInTheDocument();
    expect(
      screen.getByText(/Payments · Logistics & freight · Tax treatment/),
    ).toBeInTheDocument();
  });

  it('reports an unauthorized selling currency as not authorized', async () => {
    listProfilesForSellerMock.mockResolvedValue([profile()]);

    await renderSection(true);

    expect(screen.getByText('Not yet authorized')).toBeInTheDocument();
  });

  it('shows a draft as pending setup with an Activate control', async () => {
    listProfilesForSellerMock.mockResolvedValue([
      profile({ status: 'DRAFT', version: 1, activatedAt: null }),
    ]);

    await renderSection(true);

    expect(screen.getByText('Pending setup')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Activate' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Suspend' }),
    ).not.toBeInTheDocument();
  });

  it('shows a suspended profile without lifecycle controls', async () => {
    listProfilesForSellerMock.mockResolvedValue([
      profile({ status: 'SUSPENDED' }),
    ]);

    await renderSection(true);

    expect(screen.getByText('Suspended')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Activate' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Suspend' }),
    ).not.toBeInTheDocument();
  });

  it('hides every lifecycle control from a read-only role', async () => {
    listProfilesForSellerMock.mockResolvedValue([profile()]);

    await renderSection(false);

    expect(
      screen.queryByRole('button', { name: 'Suspend' }),
    ).not.toBeInTheDocument();
  });
});

describe('MarketProfileSection — policy independence', () => {
  beforeEach(() => {
    listProfilesForSellerMock.mockResolvedValue([]);
  });

  it('states the global destination policy separately from the account setup', async () => {
    await renderSection(true);

    expect(
      screen.getByText('Global catalogue destinations'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not a statement that your account sells to them/),
    ).toBeInTheDocument();
  });

  it('keeps business registration and reference currency as separate facts', async () => {
    await renderSection(true);

    expect(screen.getByText('Sals3 business registration')).toBeInTheDocument();
    expect(screen.getByText('Portal reference currency')).toBeInTheDocument();
    expect(
      screen.getByText(/Not a checkout currency, a settlement contract/),
    ).toBeInTheDocument();
  });

  it('labels the section for assistive technology', async () => {
    await renderSection(true);

    expect(
      screen.getByRole('region', { name: 'Your market setup' }),
    ).toBeInTheDocument();
  });
});
