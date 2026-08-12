// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CjProduct } from '@/lib/cj/normalize';

vi.mock('@/lib/db/client', () => ({
  default: () => ({}),
  isDatabaseConfigured: () => true,
}));

const repository = {
  findProviderByCode: vi.fn(),
  findConnectionBySellerAndProvider: vi.fn(),
};

vi.mock('@/modules/suppliers/repository', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/modules/suppliers/repository')>();

  return {
    ...original,
    findProviderByCode: (...args: unknown[]) =>
      repository.findProviderByCode(...args),
    findConnectionBySellerAndProvider: (...args: unknown[]) =>
      repository.findConnectionBySellerAndProvider(...args),
  };
});

const findPipelineMatchesByPid = vi.fn();

vi.mock('./supplier-products-queries', () => ({
  findPipelineMatchesByPid: (...args: unknown[]) =>
    findPipelineMatchesByPid(...args),
}));

// eslint-disable-next-line import/first
import { resetRateLimiter } from '@/lib/rate-limit';
// eslint-disable-next-line import/first
import { CjApiError } from '@/services/cj/config';
// eslint-disable-next-line import/first
import type { SupplierProviderAdapter } from '@/modules/suppliers/contracts';
// eslint-disable-next-line import/first
import {
  LIVE_BROWSE_PAGE_SIZE,
  loadLiveBrowsePage,
  resetLiveBrowseCategoryCache,
} from './live-browse';

function liveProduct(id: string): CjProduct {
  return {
    id,
    name: `Product ${id}`,
    sku: `SKU-${id}`,
    imageUrl: null,
    category: 'Pet Toy Set',
    categoryId: 'cat-9',
    priceCentsUsd: 968,
    weight: '100 g',
    productType: '—',
    supplier: '—',
    freeShipping: false,
    shipsFrom: ['CN'],
    listedCount: 4000,
    createdAt: '2026-08-01',
  };
}

function stubAdapter(
  overrides: Partial<SupplierProviderAdapter> = {},
): SupplierProviderAdapter {
  return {
    listBrowsePage: vi.fn().mockResolvedValue({
      products: [liveProduct('pid-1'), liveProduct('pid-2')],
      requestedPageNum: 1,
      pageNum: 1,
      pageSize: 200,
      total: 401,
      totalPages: 3,
      pointsInfo: null,
    }),
    getCategoryTree: vi
      .fn()
      .mockResolvedValue([
        { categoryId: 'cat-9', categoryName: 'Pet Toy Set', path: ['Pets'] },
      ]),
    ...overrides,
  } as unknown as SupplierProviderAdapter;
}

const baseInput = {
  sellerAccountId: 'seller-1',
  userId: 'user-1',
  query: { page: 1, search: '', categoryId: '' },
};

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimiter();
  resetLiveBrowseCategoryCache();
  repository.findProviderByCode.mockResolvedValue({ id: 'provider-1' });
  repository.findConnectionBySellerAndProvider.mockResolvedValue({
    id: 'connection-1',
    status: 'CONNECTED',
  });
  findPipelineMatchesByPid.mockResolvedValue(new Map());
});

describe('loadLiveBrowsePage', () => {
  it('returns no-connection when the seller has no CJ connection, before any supplier call', async () => {
    repository.findConnectionBySellerAndProvider.mockResolvedValue(null);
    const adapter = stubAdapter();

    const result = await loadLiveBrowsePage({ adapter }, baseInput);

    expect(result).toEqual({ ok: false, state: 'no-connection' });
    expect(adapter.listBrowsePage).not.toHaveBeenCalled();
  });

  it('returns reauth-required for a non-workable connection status', async () => {
    repository.findConnectionBySellerAndProvider.mockResolvedValue({
      id: 'connection-1',
      status: 'REAUTH_REQUIRED',
    });

    const result = await loadLiveBrowsePage(
      { adapter: stubAdapter() },
      baseInput,
    );

    expect(result).toEqual({ ok: false, state: 'reauth-required' });
  });

  it('overlays pipeline matches by pid and counts them', async () => {
    findPipelineMatchesByPid.mockResolvedValue(
      new Map([['pid-1', { candidateId: 'candidate-1', status: 'PASS' }]]),
    );

    const result = await loadLiveBrowsePage(
      { adapter: stubAdapter() },
      baseInput,
    );

    if (!result.ok) throw new Error(`Expected ok, got ${result.state}`);
    expect(result.page.rows).toHaveLength(2);
    expect(result.page.rows[0]?.match).toMatchObject({
      candidateId: 'candidate-1',
    });
    expect(result.page.rows[1]?.match).toBeNull();
    expect(result.page.matchedOnPage).toBe(1);
    expect(result.page.total).toBe(401);
    expect(result.page.pageSize).toBe(LIVE_BROWSE_PAGE_SIZE);
    expect(findPipelineMatchesByPid).toHaveBeenCalledWith('seller-1', [
      'pid-1',
      'pid-2',
    ]);
  });

  it('passes search, category, and ordering through to the adapter only when set', async () => {
    const adapter = stubAdapter();

    await loadLiveBrowsePage(
      { adapter },
      {
        ...baseInput,
        query: {
          page: 2,
          search: 'cat toy',
          categoryId: 'cat-9',
          orderBy: 'listedNum',
          sort: 'desc',
        },
      },
    );

    expect(adapter.listBrowsePage).toHaveBeenCalledWith('connection-1', {
      pageNum: 2,
      pageSize: 200,
      search: 'cat toy',
      categoryId: 'cat-9',
      orderBy: 'listedNum',
      sort: 'desc',
    });

    await loadLiveBrowsePage({ adapter }, baseInput);

    expect(adapter.listBrowsePage).toHaveBeenLastCalledWith('connection-1', {
      pageNum: 1,
      pageSize: 200,
    });
  });

  it('maps supplier errors to safe states', async () => {
    const cases: Array<[CjApiError, string]> = [
      [new CjApiError('rate-limited'), 'rate-limited'],
      [new CjApiError('authentication-failed'), 'reauth-required'],
      [new CjApiError('missing-credentials'), 'reauth-required'],
      [new CjApiError('upstream-unavailable'), 'unavailable'],
      [new CjApiError('unexpected-response'), 'unavailable'],
    ];

    const results = await Promise.all(
      cases.map(([error]) => {
        const adapter = stubAdapter({
          listBrowsePage: vi.fn().mockRejectedValue(error),
        } as Partial<SupplierProviderAdapter>);

        return loadLiveBrowsePage({ adapter }, baseInput);
      }),
    );

    expect(results).toEqual(cases.map(([, state]) => ({ ok: false, state })));
  });

  it('throttles locally before spending a supplier call', async () => {
    const adapter = stubAdapter();
    let clock = 0;
    const deps = { adapter, now: () => clock };

    const first30 = await Promise.all(
      Array.from({ length: 30 }, () => loadLiveBrowsePage(deps, baseInput)),
    );
    expect(first30.every((result) => result.ok)).toBe(true);

    const throttled = await loadLiveBrowsePage(deps, baseInput);
    expect(throttled).toEqual({ ok: false, state: 'throttled-locally' });
    expect(adapter.listBrowsePage).toHaveBeenCalledTimes(30);

    // One token refills after the 2s interval.
    clock = 2_000;
    const afterRefill = await loadLiveBrowsePage(deps, baseInput);
    expect(afterRefill.ok).toBe(true);
  });

  it('caches the category tree per connection and degrades to no options on failure', async () => {
    const adapter = stubAdapter();
    let clock = 0;
    const deps = { adapter, now: () => clock };

    const first = await loadLiveBrowsePage(deps, baseInput);
    const second = await loadLiveBrowsePage(deps, baseInput);

    if (!first.ok || !second.ok) throw new Error('Expected ok results');
    expect(adapter.getCategoryTree).toHaveBeenCalledTimes(1);
    expect(second.page.categories).toEqual(first.page.categories);

    // Past the TTL the tree is re-read; a failure degrades, never throws.
    clock = 61 * 60 * 1_000;
    (adapter.getCategoryTree as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CjApiError('upstream-unavailable'),
    );
    const third = await loadLiveBrowsePage(deps, baseInput);
    if (!third.ok) throw new Error(`Expected ok, got ${third.state}`);
    expect(third.page.categories).toEqual(first.page.categories);
  });
});
