import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveCategoryPolicyAction: vi.fn(),
  getCategoryPolicyHistoryAction: vi
    .fn()
    .mockResolvedValue({ ok: true, data: [] }),
  deactivateCategoryPolicyAction: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn() },
}));

vi.mock('@/app/(portal)/market-rules/pricing-actions', () => ({
  saveCategoryPolicyAction: mocks.saveCategoryPolicyAction,
  getCategoryPolicyHistoryAction: mocks.getCategoryPolicyHistoryAction,
  deactivateCategoryPolicyAction: mocks.deactivateCategoryPolicyAction,
}));

/* eslint-disable import/first */
import CategoryMarginTree from './CategoryMarginTree';
import {
  ALL_MARKETS_KEY,
  effectiveMarginFor,
  type CategoryMarginNodeViewModel,
  type CategoryMarginPolicyViewModel,
} from './category-margin-model';

const DESTINATIONS = [
  { code: 'AU', label: 'Australia' },
  { code: 'PH', label: 'Philippines' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'FJ', label: 'Fiji' },
];

function node(
  path: string,
  overrides: Partial<CategoryMarginNodeViewModel> = {},
): CategoryMarginNodeViewModel {
  const segments = path.split(' > ');

  return {
    categoryId: `id-${path}`,
    code: `CODE-${path}`,
    path,
    name: segments[segments.length - 1],
    depth: segments.length,
    parentPath: segments.length > 1 ? segments.slice(0, -1).join(' > ') : null,
    childCount: 0,
    subtreeCount: 0,
    policies: {},
    ...overrides,
  };
}

function policy(
  rate: string,
  marketCode: string | null,
): CategoryMarginPolicyViewModel {
  return {
    id: `policy-${marketCode ?? 'all'}-${rate}`,
    targetMarginRate: rate,
    roundingRule: 'NONE' as const,
    version: 1,
    updatedAt: new Date('2026-08-10T00:00:00Z'),
    marketCode,
  };
}

/** Keyed the way the repository keys them — destination code, or the all-markets key. */
function scoped(rate: string, marketCode: string) {
  return { [marketCode]: policy(rate, marketCode) };
}

const STORE_DEFAULT = {
  targetMarginRate: '0.350000',
  roundingRule: 'NONE' as const,
};

/** Every destination sharing one default, which is the ordinary starting state. */
const STORE_DEFAULTS = Object.fromEntries(
  DESTINATIONS.map((destination) => [destination.code, STORE_DEFAULT]),
);

const APPAREL = node('Apparel & Accessories', {
  childCount: 1,
  subtreeCount: 2,
});
const CLOTHING = node('Apparel & Accessories > Clothing', {
  childCount: 1,
  subtreeCount: 1,
});
const JACKETS = node('Apparel & Accessories > Clothing > Jackets');
const ELECTRONICS = node('Electronics', {
  policies: { ...scoped('0.400000', 'AU'), ...scoped('0.600000', 'FJ') },
});

const NODES = [APPAREL, CLOTHING, JACKETS, ELECTRONICS];

function nodesByPath(nodes: CategoryMarginNodeViewModel[]) {
  return new Map(nodes.map((entry) => [entry.path, entry]));
}

function renderTree(props: Partial<{ canManage: boolean }> = {}) {
  return render(
    <CategoryMarginTree
      nodes={NODES}
      destinations={DESTINATIONS}
      storeDefaults={STORE_DEFAULTS}
      sellerAccountId="seller-1"
      canManage={props.canManage ?? true}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('effectiveMarginFor — mirrors the resolver chain, per destination', () => {
  it('reads each destination independently on the same category', () => {
    const map = nodesByPath(NODES);

    // The whole point of the columns: one category, two different answers.
    expect(effectiveMarginFor(ELECTRONICS, map, STORE_DEFAULT, 'AU')).toEqual({
      source: 'SELF',
      rate: '0.400000',
      viaAllMarkets: false,
    });
    expect(effectiveMarginFor(ELECTRONICS, map, STORE_DEFAULT, 'FJ')).toEqual({
      source: 'SELF',
      rate: '0.600000',
      viaAllMarkets: false,
    });
  });

  it('a destination with no rule of its own falls through, it does not borrow another', () => {
    // PH must not show AU's 40%. Borrowing a sibling destination's rate is the
    // failure this whole screen would be worthless for.
    expect(
      effectiveMarginFor(ELECTRONICS, nodesByPath(NODES), STORE_DEFAULT, 'PH'),
    ).toEqual({ source: 'STORE_DEFAULT', rate: '0.350000' });
  });

  it('a deep node inherits the NEAREST priced ancestor for that destination', () => {
    const pricedApparel = node('Apparel & Accessories', {
      policies: scoped('0.200000', 'AU'),
      childCount: 1,
      subtreeCount: 2,
    });
    const pricedClothing = node('Apparel & Accessories > Clothing', {
      policies: scoped('0.550000', 'AU'),
      childCount: 1,
      subtreeCount: 1,
    });
    const map = nodesByPath([pricedApparel, pricedClothing, JACKETS]);

    expect(effectiveMarginFor(JACKETS, map, STORE_DEFAULT, 'AU')).toEqual({
      source: 'ANCESTOR',
      rate: '0.550000',
      ancestorName: 'Clothing',
      viaAllMarkets: false,
    });
  });

  it('prefers the destination rule over an all-destinations rule at the same depth', () => {
    const both = node('Electronics', {
      policies: {
        ...scoped('0.400000', 'AU'),
        [ALL_MARKETS_KEY]: policy('0.250000', null),
      },
    });

    // `outranks` in the resolver: depth beats market, and market beats
    // unscoped only at equal depth. Reversing these two here would display a
    // rate the resolver would never use.
    expect(
      effectiveMarginFor(both, nodesByPath([both]), STORE_DEFAULT, 'AU'),
    ).toEqual({ source: 'SELF', rate: '0.400000', viaAllMarkets: false });
  });

  it('still shows an all-destinations rule rather than pretending it is unset', () => {
    const legacy = node('Electronics', {
      policies: { [ALL_MARKETS_KEY]: policy('0.250000', null) },
    });

    // Before the fan-out migration runs, these are the rows actually pricing.
    // A reader that ignored them would show "—" for a live rule.
    expect(
      effectiveMarginFor(legacy, nodesByPath([legacy]), STORE_DEFAULT, 'PH'),
    ).toEqual({ source: 'SELF', rate: '0.250000', viaAllMarkets: true });
  });

  it('reports NONE honestly when nothing anywhere prices it', () => {
    expect(effectiveMarginFor(JACKETS, nodesByPath(NODES), null, 'AU')).toEqual(
      { source: 'NONE' },
    );
  });
});

describe('CategoryMarginTree', () => {
  it('gives every destination a column header', () => {
    renderTree();

    DESTINATIONS.forEach((destination) => {
      expect(
        screen.getByRole('columnheader', { name: destination.code }),
      ).toBeInTheDocument();
    });
  });

  it('renders only departments initially — subtrees stay collapsed', () => {
    renderTree();

    expect(screen.getByText('Apparel & Accessories')).toBeInTheDocument();
    expect(screen.getByText('Electronics')).toBeInTheDocument();
    expect(screen.queryByText('Clothing')).toBeNull();
  });

  it('shows one category two different rates on the same row', () => {
    renderTree();

    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('names the destination in each cell, so the column is not the only clue', () => {
    renderTree();

    expect(
      screen.getByRole('button', {
        name: 'Electronics — Australia: Set on this category. Edit.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Electronics — Philippines: Store default. Edit.',
      }),
    ).toBeInTheDocument();
  });

  it('search flattens to matching nodes shown with their full path', () => {
    renderTree();

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'jackets' },
    });

    expect(
      screen.getByText('Apparel & Accessories > Clothing > Jackets'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Electronics')).toBeNull();
  });

  it('says plainly when a search matches nothing', () => {
    renderTree();

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'zzz' },
    });

    expect(screen.getByText(/No category matches/)).toBeInTheDocument();
  });

  it('saves against the destination whose cell was clicked, not the first one', async () => {
    mocks.saveCategoryPolicyAction.mockResolvedValue({ ok: true });

    renderTree();

    // Nothing is editable until the pop-out is opened — the table itself
    // carries no inputs any more.
    expect(
      screen.queryByLabelText('Margin percent for Apparel & Accessories'),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Apparel & Accessories — Fiji: Store default. Edit.',
      }),
    );

    const marginInput = await screen.findByLabelText(
      'Margin percent for Apparel & Accessories',
    );
    fireEvent.change(marginInput, { target: { value: '40' } });
    fireEvent.change(
      screen.getByLabelText('Reason for change to Apparel & Accessories'),
      { target: { value: 'Freight to Fiji is four times the PH lane.' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save margin' }));

    await waitFor(() =>
      expect(mocks.saveCategoryPolicyAction).toHaveBeenCalledWith({
        categoryCode: 'CODE-Apparel & Accessories',
        targetMarginRate: '0.4',
        roundingRule: 'NONE',
        reason: 'Freight to Fiji is four times the PH lane.',
        // The clicked column. If this ever came from anywhere but the cell,
        // a seller would price the wrong country and the screen would look
        // exactly the same.
        marketCode: 'FJ',
      }),
    );
  });

  it('names the destination in the editor, which the cell behind it no longer can', async () => {
    renderTree();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Electronics — Fiji: Set on this category. Edit.',
      }),
    );

    expect(
      await screen.findByText(/Edit margin — Electronics · Fiji/),
    ).toBeInTheDocument();
  });

  it('read-only callers get no editable cells at all', () => {
    renderTree({ canManage: false });

    expect(screen.queryByRole('button', { name: /Edit\.$/ })).toBeNull();
    // The rates are still readable — read-only is not blank.
    expect(screen.getByText('40%')).toBeInTheDocument();
  });
});
