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
    'https://portal.test/api/storefront/products?section=deals&limit=2',
    {
      headers:
        token === undefined ? undefined : { authorization: `Bearer ${token}` },
    },
  );
}

function cjPage(): CjProductPage {
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
  };
}

describe('storefront products API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.getStorefrontCjProducts.mockReset();
  });

  it('rejects requests without the storefront token', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.getStorefrontCjProducts).not.toHaveBeenCalled();
  });

  it('returns the protected CJ supplier product feed', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.getStorefrontCjProducts.mockResolvedValue(cjPage());

    const response = await GET(request('secret'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.products[0].title).toBe(
      'Insole For Flat-foot Correction Pure Blue',
    );
    expect(mocks.getStorefrontCjProducts).toHaveBeenCalledWith({
      cjPage: 1,
      cjSearch: '',
    });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
