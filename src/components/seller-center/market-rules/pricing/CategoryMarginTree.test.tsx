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

/**
 * The six measured destinations, then Global — the order the screen shows and
 * the shape `listPricingScopes()` returns. Global's `marketCode` is `null`
 * because that is what a Global rule stores; its `key` is what the column, the
 * React key and the policy lookup use.
 */
const SCOPES = [
  { key: 'AU', label: 'Australia', marketCode: 'AU', isGlobal: false },
  { key: 'PH', label: 'Philippines', marketCode: 'PH', isGlobal: false },
  { key: 'NZ', label: 'New Zealand', marketCode: 'NZ', isGlobal: false },
  { key: 'US', label: 'United States', marketCode: 'US', isGlobal: false },
  { key: 'CA', label: 'Canada', marketCode: 'CA', isGlobal: false },
  { key: 'FJ', label: 'Fiji', marketCode: 'FJ', isGlobal: false },
  { key: 'GLOBAL', label: 'Global', marketCode: null, isGlobal: true },
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

/** Keyed the way the repository keys them — destination code, or the Global key. */
function scoped(rate: string, marketCode: string) {
  return { [marketCode]: policy(rate, marketCode) };
}

/** A rule stored with `market_code IS NULL`, filed under the Global key. */
function globalRule(rate: string) {
  return { [ALL_MARKETS_KEY]: policy(rate, null) };
}

const STORE_DEFAULT = {
  targetMarginRate: '0.350000',
  roundingRule: 'NONE' as const,
};

/** Every scope sharing one default, which is the ordinary starting state. */
const STORE_DEFAULTS = Object.fromEntries(
  SCOPES.map((scope) => [scope.key, STORE_DEFAULT]),
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
      scopes={SCOPES}
      storeDefaults={STORE_DEFAULTS}
      sellerAccountId="seller-1"
      canManage={props.canManage ?? true}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('effectiveMarginFor — mirrors the resolver chain, per scope', () => {
  it('reads each scope independently on the same category', () => {
    const map = nodesByPath(NODES);

    // The whole point of the columns: one category, two different answers.
    expect(effectiveMarginFor(ELECTRONICS, map, STORE_DEFAULT, 'AU')).toEqual({
      source: 'SELF',
      rate: '0.400000',
    });
    expect(effectiveMarginFor(ELECTRONICS, map, STORE_DEFAULT, 'FJ')).toEqual({
      source: 'SELF',
      rate: '0.600000',
    });
  });

  it('a scope with no rule of its own falls through, it does not borrow another', () => {
    // PH must not show AU's 40%. Borrowing a sibling scope's rate is the
    // failure this whole screen would be worthless for.
    expect(
      effectiveMarginFor(ELECTRONICS, nodesByPath(NODES), STORE_DEFAULT, 'PH'),
    ).toEqual({ source: 'STORE_DEFAULT', rate: '0.350000' });
  });

  it('a deep node inherits the NEAREST priced ancestor for that scope', () => {
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
    });
  });

  it('reads each scope on its own, with no widening between them', () => {
    const both = node('Electronics', {
      policies: { ...scoped('0.400000', 'AU'), ...globalRule('0.250000') },
    });
    const map = nodesByPath([both]);

    // Owner decision 2026-08-27 narrowed Global from "all destinations" to
    // "every country without a column of its own", and `outranks` became
    // depth-only to match. Each column is one lookup: Australia reads
    // Australia's rule, Global reads Global's, and neither reaches the other.
    expect(effectiveMarginFor(both, map, STORE_DEFAULT, 'AU')).toEqual({
      source: 'SELF',
      rate: '0.400000',
    });
    expect(
      effectiveMarginFor(both, map, STORE_DEFAULT, ALL_MARKETS_KEY),
    ).toEqual({ source: 'SELF', rate: '0.250000' });
  });

  it('a Global rule does not price a destination that has a column of its own', () => {
    const globalOnly = node('Electronics', {
      policies: globalRule('0.250000'),
    });
    const map = nodesByPath([globalOnly]);

    // The reverse of what this file asserted until 2026-08-27, and deliberately
    // so: showing 25% under Philippines would display a rate the resolver will
    // never apply there, which is the exact thing per-destination margins exist
    // to stop.
    expect(effectiveMarginFor(globalOnly, map, STORE_DEFAULT, 'PH')).toEqual({
      source: 'STORE_DEFAULT',
      rate: '0.350000',
    });
    // The rule is not lost, though — it prices its own scope.
    expect(
      effectiveMarginFor(globalOnly, map, STORE_DEFAULT, ALL_MARKETS_KEY),
    ).toEqual({ source: 'SELF', rate: '0.250000' });
  });

  it('reports NONE honestly when nothing anywhere prices it', () => {
    expect(effectiveMarginFor(JACKETS, nodesByPath(NODES), null, 'AU')).toEqual(
      { source: 'NONE' },
    );
  });
});

describe('CategoryMarginTree', () => {
  it('gives every scope a column header, Global included', () => {
    renderTree();

    SCOPES.forEach((scope) => {
      expect(
        screen.getByRole('columnheader', { name: scope.key }),
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

    expect(screen.getByText('66.67%')).toBeInTheDocument();
    expect(screen.getByText('150%')).toBeInTheDocument();
  });

  it('names the scope in each cell, so the column is not the only clue', () => {
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

  it('saves against the scope whose cell was clicked, not the first one', async () => {
    mocks.saveCategoryPolicyAction.mockResolvedValue({ ok: true });

    renderTree();

    // Nothing is editable until the pop-out is opened — the table itself
    // carries no inputs any more.
    expect(
      screen.queryByLabelText('Markup percent for Apparel & Accessories'),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Apparel & Accessories — Fiji: Store default. Edit.',
      }),
    );

    const marginInput = await screen.findByLabelText(
      'Markup percent for Apparel & Accessories',
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
        // 40 is now markup over cost, so the stored margin rate is 40/140.
        targetMarginRate: '0.285714',
        roundingRule: 'NONE',
        reason: 'Freight to Fiji is four times the PH lane.',
        // The clicked column. If this ever came from anywhere but the cell,
        // a seller would price the wrong country and the screen would look
        // exactly the same.
        marketCode: 'FJ',
      }),
    );
  });

  it('names the scope in the editor, which the cell behind it no longer can', async () => {
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

  it('shows a Global rule in the Global column and nowhere else', () => {
    const globalOnly = node('Electronics', {
      policies: globalRule('0.250000'),
    });

    render(
      <CategoryMarginTree
        nodes={[globalOnly]}
        scopes={SCOPES}
        storeDefaults={STORE_DEFAULTS}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    expect(
      screen.getByRole('button', {
        name: 'Electronics — Global: Set on this category. Edit.',
      }),
    ).toBeInTheDocument();
    // Australia has a column of its own, so it falls to its own store default
    // rather than borrowing the everywhere-else rate.
    expect(
      screen.getByRole('button', {
        name: 'Electronics — Australia: Store default. Edit.',
      }),
    ).toBeInTheDocument();
  });

  it('saves the Global cell as a null market code, never as its column key', async () => {
    mocks.saveCategoryPolicyAction.mockResolvedValue({ ok: true });

    renderTree();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Apparel & Accessories — Global: Store default. Edit.',
      }),
    );

    fireEvent.change(
      await screen.findByLabelText('Markup percent for Apparel & Accessories'),
      { target: { value: '25' } },
    );
    fireEvent.change(
      screen.getByLabelText('Reason for change to Apparel & Accessories'),
      { target: { value: 'Everywhere we have not measured freight for.' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save margin' }));

    // `GLOBAL` is the column's name and nothing else. `market_code` holds a
    // country code or NULL, and the action's schema refuses anything that is
    // neither — so sending the key would fail the save outright.
    await waitFor(() =>
      expect(mocks.saveCategoryPolicyAction).toHaveBeenCalledWith(
        expect.objectContaining({ marketCode: null }),
      ),
    );
  });

  it('read-only callers get no editable cells at all', () => {
    renderTree({ canManage: false });

    expect(screen.queryByRole('button', { name: /Edit\.$/ })).toBeNull();
    // The rates are still readable — read-only is not blank.
    expect(screen.getByText('66.67%')).toBeInTheDocument();
  });
  /**
   * The unit this screen states, pinned against the one the import sheet
   * writes.
   *
   * A seller entered `300` in the sheet's `markup_percent` column and read
   * `75%` here, which is the same rule in the other unit — and reasonably took
   * it as the import having been ignored. Worse, `300` was entered believing it
   * meant 3x cost; it is 4x, and a whole catalogue went out at the wrong
   * multiple before anybody noticed.
   *
   * These cases exist so the two surfaces can never drift apart again in
   * silence.
   */
  describe('the unit on the screen', () => {
    function renderRate(rate: string) {
      return render(
        <CategoryMarginTree
          nodes={[node('Electronics', { policies: scoped(rate, 'AU') })]}
          scopes={SCOPES}
          storeDefaults={STORE_DEFAULTS}
          sellerAccountId="seller-1"
          canManage
        />,
      );
    }

    it.each([
      ['3x cost', '0.666667', '200%'],
      ['4x cost', '0.750000', '300%'],
      ['half again', '0.333333', '50%'],
    ])('renders a %s rule as markup over cost', (_label, rate, shown) => {
      renderRate(rate);

      expect(screen.getAllByText(shown).length).toBeGreaterThan(0);
    });

    it('never shows the stored margin, which is the number that confused a seller', () => {
      renderRate('0.750000');

      expect(screen.getAllByText('300%').length).toBeGreaterThan(0);
      expect(screen.queryByText('75%')).toBeNull();
    });
  });
});
