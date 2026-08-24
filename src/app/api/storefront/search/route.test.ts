import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontListRow } from '@/modules/catalog/storefront/read-model';

const mocks = vi.hoisted(() => ({ readStorefrontSearch: vi.fn() }));

vi.mock('@/lib/storefront/catalog-cache', () => ({
  readStorefrontSearch: mocks.readStorefrontSearch,
}));

const { GET } = await import('./route');

function call(token = 'secret', query = 'q=lamp') {
  return GET(
    new Request(`https://portal.test/api/storefront/search?${query}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
}

function row(overrides: Partial<StorefrontListRow> = {}): StorefrontListRow {
  return {
    id: '90a329b9-56aa-4f54-abb2-ad843602aa73',
    slug: 'solar-wall-lamp',
    title: 'Solar Wall Lamp With Motion Sensor',
    priceMinor: 2299,
    priceCurrency: 'USD',
    availabilityState: 'AVAILABLE',
    categoryCode: 'CAT-GGL-5079',
    categoryPath: 'Home & Garden > Lighting',
    primaryImageUrl: 'https://cf.cjdropshipping.com/quick/product/a.jpg',
    publishedAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('storefront search API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.readStorefrontSearch.mockReset();
  });

  it('rejects requests without the storefront token', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await GET(
      new Request('https://portal.test/api/storefront/search?q=lamp'),
    );

    expect(response.status).toBe(401);
    expect(mocks.readStorefrontSearch).not.toHaveBeenCalled();
  });

  it('searches the published catalogue', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontSearch.mockResolvedValue({ rows: [row()], total: 1 });

    const response = await call();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.products[0]).toMatchObject({ slug: 'solar-wall-lamp' });
    expect(mocks.readStorefrontSearch).toHaveBeenCalledWith(
      'lamp',
      undefined,
      'newest',
      1,
      30,
      undefined,
      undefined,
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  /**
   * Clearing the box is an ordinary interaction, not a malformed request — and
   * it must not cost a query.
   */
  it('answers a blank term with an empty feed and no database read', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await call('secret', 'q=%20%20');
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      products: [],
      total: 0,
      page: 1,
      limit: 30,
      totalPages: 1,
    });
    expect(mocks.readStorefrontSearch).not.toHaveBeenCalled();
  });

  it('resolves a category slug to its taxonomy name', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontSearch.mockResolvedValue({ rows: [], total: 0 });

    await call('secret', 'q=lamp&category=home-garden&sort=price-asc');

    expect(mocks.readStorefrontSearch).toHaveBeenCalledWith(
      'lamp',
      'Home & Garden',
      'price-asc',
      1,
      30,
      undefined,
      undefined,
    );
  });

  /**
   * A filter the caller asked for and did not get is worse than one that
   * matched nothing: only the second is visible in the answer.
   */
  it('narrows to nothing for a category outside the allow-list', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await call('secret', 'q=lamp&category=not-a-department');
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.total).toBe(0);
    expect(mocks.readStorefrontSearch).not.toHaveBeenCalled();
  });

  it('passes the price window through and pages on the served limit', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontSearch.mockResolvedValue({ rows: [row()], total: 31 });

    const response = await call(
      'secret',
      'q=lamp&page=2&limit=10&minPriceMinor=1500&maxPriceMinor=3000',
    );
    const payload = await response.json();

    expect(mocks.readStorefrontSearch).toHaveBeenCalledWith(
      'lamp',
      undefined,
      'newest',
      2,
      10,
      1500,
      3000,
    );
    expect(payload.totalPages).toBe(4);
  });

  it('degrades a junk query string rather than answering 400', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontSearch.mockResolvedValue({ rows: [], total: 0 });

    await call(
      'secret',
      'q=lamp&sort=cheapest&page=-3&limit=999&minPriceMinor=abc',
    );

    expect(mocks.readStorefrontSearch).toHaveBeenCalledWith(
      'lamp',
      undefined,
      'newest',
      1,
      30,
      undefined,
      undefined,
    );
  });

  it('answers a database failure with a generic 503 and leaks nothing', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.readStorefrontSearch.mockRejectedValue(
      new Error('relation "products" does not exist'),
    );

    const response = await call();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Catalog temporarily unavailable' });
    expect(JSON.stringify(payload)).not.toContain('products');
  });
});
