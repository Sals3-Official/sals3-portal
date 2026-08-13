import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readStorefrontCategories: vi.fn(),
}));

vi.mock('@/lib/storefront/catalog-cache', () => ({
  readStorefrontCategories: mocks.readStorefrontCategories,
}));

const { GET } = await import('./route');

function request(token?: string) {
  return new Request('https://portal.test/api/storefront/categories', {
    headers:
      token === undefined ? undefined : { authorization: `Bearer ${token}` },
  });
}

describe('storefront categories API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.readStorefrontCategories.mockReset();
  });

  it('rejects requests without the storefront token', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.readStorefrontCategories).not.toHaveBeenCalled();
  });

  it('serves the categories that have a published product', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontCategories.mockResolvedValue([
      { code: 'CAT-APP-100412', path: "Apparel > Outerwear > Men's Jackets" },
      { code: 'CAT-HOM-100123', path: 'Home & Garden > Kitchen > Cookware' },
    ]);

    const response = await GET(request('secret'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual([
      { id: 'cat-app-100412', code: 'MJ', name: "Men's Jackets" },
      { id: 'cat-hom-100123', code: 'CO', name: 'Cookware' },
    ]);
  });

  it('serves an empty list rather than an error when nothing is published', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontCategories.mockResolvedValue([]);

    const response = await GET(request('secret'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});
