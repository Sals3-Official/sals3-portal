import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontDetailRow } from '@/modules/catalog/storefront/read-model';

const mocks = vi.hoisted(() => ({
  readStorefrontProduct: vi.fn(),
}));

vi.mock('@/lib/storefront/catalog-cache', () => ({
  readStorefrontProduct: mocks.readStorefrontProduct,
}));

const { GET } = await import('./route');

function call(slug: string, token = 'secret') {
  return GET(
    new Request(
      `https://portal.test/api/storefront/products/${encodeURIComponent(slug)}`,
      { headers: { authorization: `Bearer ${token}` } },
    ),
    { params: Promise.resolve({ id: slug }) },
  );
}

function row(): StorefrontDetailRow {
  return {
    id: '90a329b9-56aa-4f54-abb2-ad843602aa73',
    slug: 'waterproof-shell-jacket',
    title: 'Mens Short-Style Cold-Weather Waterproof Shell Jacket',
    priceMinor: 4299,
    priceCurrency: 'USD',
    availabilityState: 'AVAILABLE',
    categoryCode: 'CAT-APP-100412',
    categoryPath: "Apparel > Outerwear > Men's Jackets",
    primaryImageUrl: 'https://cf.cjdropshipping.com/quick/product/a.jpg',
    publishedAt: '2026-08-13T00:00:00.000Z',
    images: [{ url: 'https://cf.cjdropshipping.com/quick/product/a.jpg' }],
  };
}

describe('storefront single-product API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.readStorefrontProduct.mockReset();
  });

  it('rejects requests without the storefront token', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await call('waterproof-shell-jacket', 'wrong');

    expect(response.status).toBe(401);
    expect(mocks.readStorefrontProduct).not.toHaveBeenCalled();
  });

  it('serves a published product by slug', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontProduct.mockResolvedValue(row());

    const response = await call('waterproof-shell-jacket');
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.product.slug).toBe('waterproof-shell-jacket');
    expect(payload.product.currency).toBe('USD');
    expect(mocks.readStorefrontProduct).toHaveBeenCalledWith(
      'waterproof-shell-jacket',
    );
  });

  it('answers 404 for an unpublished or unknown slug', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontProduct.mockResolvedValue(null);

    const response = await call('no-such-product');

    expect(response.status).toBe(404);
  });

  /**
   * A non-slug path segment must not reach a query at all — and it must answer
   * exactly as "not found" does, so a caller cannot probe which drafts exist.
   */
  it.each(['Not A Slug', '../../etc/passwd', '', 'a'.repeat(200)])(
    'rejects %j without querying',
    async (slug) => {
      vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

      const response = await call(slug);

      expect(response.status).toBe(404);
      expect(mocks.readStorefrontProduct).not.toHaveBeenCalled();
    },
  );

  it('answers a database failure with a generic 503', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.readStorefrontProduct.mockRejectedValue(new Error('connection lost'));

    const response = await call('waterproof-shell-jacket');
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Catalog temporarily unavailable' });
  });
});
