import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readStorefrontCategories: vi.fn(),
  readStorefrontDepartments: vi.fn(),
}));

vi.mock('@/lib/storefront/catalog-cache', () => ({
  readStorefrontCategories: mocks.readStorefrontCategories,
  readStorefrontDepartments: mocks.readStorefrontDepartments,
}));

const { GET } = await import('./route');

function request(token?: string, scope?: string) {
  const url = new URL('https://portal.test/api/storefront/categories');

  if (scope !== undefined) url.searchParams.set('scope', scope);

  return new Request(url, {
    headers:
      token === undefined ? undefined : { authorization: `Bearer ${token}` },
  });
}

describe('storefront categories API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.readStorefrontCategories.mockReset();
    mocks.readStorefrontDepartments.mockReset();
  });

  it('rejects requests without the storefront token', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.readStorefrontCategories).not.toHaveBeenCalled();
  });

  it('serves the main categories that have a published product', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontCategories.mockResolvedValue([
      {
        code: 'CAT-GGL-2271',
        path: 'Apparel & Accessories > Clothing > Dresses',
      },
      {
        code: 'CAT-GGL-212',
        path: 'Apparel & Accessories > Clothing > Shirts & Tops',
      },
      { code: 'CAT-HOM-100123', path: 'Home & Garden > Kitchen > Cookware' },
    ]);

    const response = await GET(request('secret'));
    const payload = await response.json();

    // Two tiles, not three: both apparel leaves roll up into their L1.
    expect(response.status).toBe(200);
    expect(payload).toEqual([
      { id: 'apparel-accessories', code: 'AA', name: 'Apparel & Accessories' },
      { id: 'home-garden', code: 'HG', name: 'Home & Garden' },
    ]);
  });

  it('serves every taxonomy department for scope=all, stock or not', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontDepartments.mockResolvedValue([
      { l1: 'Apparel & Accessories' },
      { l1: 'Mature' },
      { l1: 'Religious & Ceremonial' },
    ]);

    const response = await GET(request('secret', 'all'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: 'apparel-accessories', code: 'AA', name: 'Apparel & Accessories' },
      { id: 'mature', code: 'MA', name: 'Mature' },
      {
        id: 'religious-ceremonial',
        code: 'RC',
        name: 'Religious & Ceremonial',
      },
    ]);
    expect(mocks.readStorefrontCategories).not.toHaveBeenCalled();
  });

  it('falls back to the stocked list when scope is unrecognised', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontCategories.mockResolvedValue([
      { code: 'CAT-GGL-1', path: 'Furniture > Chairs' },
    ]);

    const response = await GET(request('secret', 'sideways'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: 'furniture', code: 'FU', name: 'Furniture' },
    ]);
    expect(mocks.readStorefrontDepartments).not.toHaveBeenCalled();
  });

  it('serves an empty list rather than an error when nothing is published', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontCategories.mockResolvedValue([]);

    const response = await GET(request('secret'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});
