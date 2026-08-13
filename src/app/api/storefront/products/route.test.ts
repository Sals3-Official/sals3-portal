import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontListRow } from '@/modules/catalog/storefront/read-model';

const mocks = vi.hoisted(() => ({
  readStorefrontFeed: vi.fn(),
}));

vi.mock('@/lib/storefront/catalog-cache', () => ({
  readStorefrontFeed: mocks.readStorefrontFeed,
}));

const { GET } = await import('./route');

function request(token?: string, query = 'section=deals&limit=2') {
  return new Request(`https://portal.test/api/storefront/products?${query}`, {
    headers:
      token === undefined ? undefined : { authorization: `Bearer ${token}` },
  });
}

function row(overrides: Partial<StorefrontListRow> = {}): StorefrontListRow {
  return {
    id: '90a329b9-56aa-4f54-abb2-ad843602aa73',
    slug: 'mens-short-style-cold-weather-waterproof-shell-jacket',
    title: 'Mens Short-Style Cold-Weather Waterproof Shell Jacket',
    priceMinor: 4299,
    priceCurrency: 'USD',
    availabilityState: 'UNKNOWN',
    categoryCode: 'CAT-APP-100412',
    categoryPath: "Apparel > Outerwear > Men's Jackets",
    primaryImageUrl: 'https://cf.cjdropshipping.com/quick/product/a.jpg',
    publishedAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('storefront products API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.readStorefrontFeed.mockReset();
  });

  it('rejects requests without the storefront token', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.readStorefrontFeed).not.toHaveBeenCalled();
  });

  it('serves the published catalogue feed', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontFeed.mockResolvedValue({ rows: [row()], total: 1 });

    const response = await GET(request('secret'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.products[0]).toMatchObject({
      slug: 'mens-short-style-cold-weather-waterproof-shell-jacket',
      priceMinor: 4299,
      currency: 'USD',
      category: 'cat-app-100412',
      categoryName: "Men's Jackets",
      availability: 'UNKNOWN',
    });
    expect(mocks.readStorefrontFeed).toHaveBeenCalledWith('deals', 1, 2);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  /**
   * The honest state of the catalogue before anything is published. An empty
   * array is valid to the consumer's schema; a 502 was not.
   */
  it('returns an empty feed rather than an error when nothing is published', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontFeed.mockResolvedValue({ rows: [], total: 0 });

    const response = await GET(request('secret'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      products: [],
      total: 0,
      page: 1,
      limit: 2,
      totalPages: 1,
    });
  });

  /** `totalPages` must use the served page size, not a supplier's. */
  it('pages on the requested limit', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontFeed.mockResolvedValue({ rows: [row()], total: 31 });

    const response = await GET(request('secret', 'page=2&limit=14'));
    const payload = await response.json();

    expect(mocks.readStorefrontFeed).toHaveBeenCalledWith('for-you', 2, 14);
    expect(payload.totalPages).toBe(3);
  });

  it('answers a database failure with a generic 503 and leaks nothing', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.readStorefrontFeed.mockRejectedValue(
      new Error('relation "products" does not exist'),
    );

    const response = await GET(request('secret'));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Catalog temporarily unavailable' });
    expect(JSON.stringify(payload)).not.toContain('products');
  });
});
