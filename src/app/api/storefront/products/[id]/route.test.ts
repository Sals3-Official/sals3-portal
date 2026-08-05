import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CjProductPage } from '@/services/cj/products';

const mocks = vi.hoisted(() => ({
  getStorefrontCjProducts: vi.fn(),
}));

vi.mock('@/lib/storefront/cj-feed', () => ({
  getStorefrontCjProducts: mocks.getStorefrontCjProducts,
}));

const { GET } = await import('./route');

function request(token?: string) {
  return new Request(
    'https://portal.test/api/storefront/products/cjyd3038814',
    {
      headers:
        token === undefined ? undefined : { authorization: `Bearer ${token}` },
    },
  );
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function cjPage(overrides: Partial<CjProductPage> = {}): CjProductPage {
  return {
    products: [
      {
        id: 'CJYD3038814',
        name: 'Insole For Flat-foot Correction Pure Blue',
        sku: 'CJYD3038814',
        imageUrl: 'https://cf.cjdropshipping.com/image.webp',
        category: "Men's Insoles",
        priceCentsUsd: 72,
        weight: '60.00-85.00 g',
        productType: 'ordinary',
        supplier: 'CJ',
        freeShipping: false,
        shipsFrom: ['CN', 'CN_US'],
        listedCount: 4,
        createdAt: '2026-08-05',
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    ...overrides,
  };
}

describe('storefront single-product API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.getStorefrontCjProducts.mockReset();
  });

  it('rejects requests without the storefront token', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await GET(request(), context('cjyd3038814'));

    expect(response.status).toBe(401);
    expect(mocks.getStorefrontCjProducts).not.toHaveBeenCalled();
  });

  it('returns the matching product, case-insensitively, in one CJ call', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.getStorefrontCjProducts.mockResolvedValue(cjPage());

    const response = await GET(request('secret'), context('cjyd3038814'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.product.title).toBe(
      'Insole For Flat-foot Correction Pure Blue',
    );
    expect(payload.product.slug).toBe('cjyd3038814');
    expect(mocks.getStorefrontCjProducts).toHaveBeenCalledTimes(1);
    expect(mocks.getStorefrontCjProducts).toHaveBeenCalledWith({
      cjPage: 1,
      cjSearch: '',
      cjPid: 'cjyd3038814',
    });
  });

  it('returns 404 when no product matches the id', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.getStorefrontCjProducts.mockResolvedValue(cjPage({ products: [] }));

    const response = await GET(request('secret'), context('missing-id'));

    expect(response.status).toBe(404);
  });

  it('returns 404 for an empty id without calling the CJ feed', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await GET(request('secret'), context('  '));

    expect(response.status).toBe(404);
    expect(mocks.getStorefrontCjProducts).not.toHaveBeenCalled();
  });

  it('reports a typed error when the CJ feed is unavailable', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    const { CjApiError } = await import('@/services/cj/config');
    mocks.getStorefrontCjProducts.mockRejectedValue(
      new CjApiError('rate-limited'),
    );

    const response = await GET(request('secret'), context('cjyd3038814'));

    expect(response.status).toBe(502);
  });
});
