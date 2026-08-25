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
  effectiveMarginFor,
  type CategoryMarginNodeViewModel,
} from './category-margin-model';

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
    policy: null,
    ...overrides,
  };
}

function policy(rate: string) {
  return {
    id: `policy-${rate}`,
    targetMarginRate: rate,
    roundingRule: 'NONE' as const,
    version: 1,
    updatedAt: new Date('2026-08-10T00:00:00Z'),
    marketCode: null,
  };
}

const STORE_DEFAULT = {
  targetMarginRate: '0.350000',
  roundingRule: 'NONE' as const,
};

const APPAREL = node('Apparel & Accessories', {
  childCount: 1,
  subtreeCount: 2,
});
const CLOTHING = node('Apparel & Accessories > Clothing', {
  childCount: 1,
  subtreeCount: 1,
});
const JACKETS = node('Apparel & Accessories > Clothing > Jackets');
const ELECTRONICS = node('Electronics', { policy: policy('0.400000') });

const NODES = [APPAREL, CLOTHING, JACKETS, ELECTRONICS];

function nodesByPath(nodes: CategoryMarginNodeViewModel[]) {
  return new Map(nodes.map((entry) => [entry.path, entry]));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('effectiveMarginFor — mirrors the resolver chain', () => {
  it('a node with its own policy resolves as SELF', () => {
    expect(
      effectiveMarginFor(ELECTRONICS, nodesByPath(NODES), STORE_DEFAULT),
    ).toEqual({ source: 'SELF', rate: '0.400000' });
  });

  it('a deep node inherits the NEAREST priced ancestor, not the shallowest', () => {
    const pricedApparel = node('Apparel & Accessories', {
      policy: policy('0.200000'),
      childCount: 1,
      subtreeCount: 2,
    });
    const pricedClothing = node('Apparel & Accessories > Clothing', {
      policy: policy('0.550000'),
      childCount: 1,
      subtreeCount: 1,
    });
    const map = nodesByPath([pricedApparel, pricedClothing, JACKETS]);

    const result = effectiveMarginFor(JACKETS, map, STORE_DEFAULT);

    expect(result).toEqual({
      source: 'ANCESTOR',
      rate: '0.550000',
      ancestorName: 'Clothing',
    });
  });

  it('falls back to the store default when no ancestor is priced', () => {
    expect(
      effectiveMarginFor(JACKETS, nodesByPath(NODES), STORE_DEFAULT),
    ).toEqual({ source: 'STORE_DEFAULT', rate: '0.350000' });
  });

  it('reports NONE honestly when there is no policy anywhere and no default', () => {
    expect(effectiveMarginFor(JACKETS, nodesByPath(NODES), null)).toEqual({
      source: 'NONE',
    });
  });
});

describe('CategoryMarginTree', () => {
  it('renders only departments initially — subtrees stay collapsed', () => {
    render(
      <CategoryMarginTree
        nodes={NODES}
        storeDefault={STORE_DEFAULT}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    expect(screen.getByText('Apparel & Accessories')).toBeInTheDocument();
    expect(screen.getByText('Electronics')).toBeInTheDocument();
    expect(screen.queryByText('Clothing')).toBeNull();
  });

  it('expanding a department reveals its children with their inherited rate and source', () => {
    render(
      <CategoryMarginTree
        nodes={NODES}
        storeDefault={STORE_DEFAULT}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Expand Apparel & Accessories' }),
    );

    expect(screen.getByText('Clothing')).toBeInTheDocument();
    expect(screen.getAllByText('Store default').length).toBeGreaterThan(0);
  });

  it('a set rate and an inherited rate are labelled differently', () => {
    render(
      <CategoryMarginTree
        nodes={NODES}
        storeDefault={STORE_DEFAULT}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    expect(screen.getByText('This category')).toBeInTheDocument();
    // Whole rates render whole — `40.00%` was false precision.
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('search flattens to matching nodes shown with their full path', () => {
    render(
      <CategoryMarginTree
        nodes={NODES}
        storeDefault={STORE_DEFAULT}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'jackets' },
    });

    expect(
      screen.getByText('Apparel & Accessories > Clothing > Jackets'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Electronics')).toBeNull();
  });

  it('says plainly when a search matches nothing', () => {
    render(
      <CategoryMarginTree
        nodes={NODES}
        storeDefault={STORE_DEFAULT}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'zzz' },
    });

    expect(screen.getByText(/No category matches/)).toBeInTheDocument();
  });

  it('editing opens a pop-out, and saving calls the single-category action with that node code', async () => {
    mocks.saveCategoryPolicyAction.mockResolvedValue({ ok: true });

    render(
      <CategoryMarginTree
        nodes={NODES}
        storeDefault={STORE_DEFAULT}
        sellerAccountId="seller-1"
        canManage
      />,
    );

    // Nothing is editable until the pop-out is opened — the table itself
    // carries no inputs any more.
    expect(
      screen.queryByLabelText('Margin percent for Apparel & Accessories'),
    ).toBeNull();

    // Departments without a policy offer "Set".
    fireEvent.click(screen.getAllByRole('button', { name: 'Set' })[0]);

    const marginInput = await screen.findByLabelText(
      'Margin percent for Apparel & Accessories',
    );
    fireEvent.change(marginInput, { target: { value: '40' } });
    fireEvent.change(
      screen.getByLabelText('Reason for change to Apparel & Accessories'),
      { target: { value: 'Department-level default for apparel.' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save margin' }));

    await waitFor(() =>
      expect(mocks.saveCategoryPolicyAction).toHaveBeenCalledWith({
        categoryCode: 'CODE-Apparel & Accessories',
        targetMarginRate: '0.4',
        roundingRule: 'NONE',
        reason: 'Department-level default for apparel.',
      }),
    );
  });

  it('read-only callers see no Set/Edit controls at all', () => {
    render(
      <CategoryMarginTree
        nodes={NODES}
        storeDefault={STORE_DEFAULT}
        sellerAccountId="seller-1"
        canManage={false}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Set' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});
