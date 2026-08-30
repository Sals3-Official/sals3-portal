import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontListRow } from '@/modules/catalog/storefront/read-model';

const mocks = vi.hoisted(() => ({
  readStorefrontDepartmentFeed: vi.fn(),
}));

vi.mock('@/lib/storefront/catalog-cache', () => ({
  readStorefrontDepartmentFeed: mocks.readStorefrontDepartmentFeed,
}));

const { GET } = await import('./route');

function request(token?: string, slug = 'animals-pet-supplies', query = '') {
  return {
    request: new Request(
      `https://portal.test/api/storefront/categories/${slug}/products?${query}`,
      {
        headers:
          token === undefined
            ? undefined
            : { authorization: `Bearer ${token}` },
      },
    ),
    context: { params: Promise.resolve({ slug }) },
  };
}

function call(...args: Parameters<typeof request>) {
  const { request: req, context } = request(...args);

  return GET(req, context);
}

function row(overrides: Partial<StorefrontListRow> = {}): StorefrontListRow {
  return {
    id: '90a329b9-56aa-4f54-abb2-ad843602aa73',
    slug: 'aquarium-lighting-led-full-spectrum',
    title: 'Aquarium Lighting LED Full Spectrum',
    priceMinor: 2299,
    priceCurrency: 'USD',
    availabilityState: 'AVAILABLE',
    categoryCode: 'CAT-GGL-5079',
    categoryPath: 'Animals & Pet Supplies > Pet Supplies > Aquarium Lighting',
    primaryImageUrl: 'https://cf.cjdropshipping.com/quick/product/a.jpg',
    publishedAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('storefront department products API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.readStorefrontDepartmentFeed.mockReset();
  });

  it('rejects requests without the storefront token', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await call();

    expect(response.status).toBe(401);
    expect(mocks.readStorefrontDepartmentFeed).not.toHaveBeenCalled();
  });

  it('serves one department, resolving its slug to the taxonomy name', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontDepartmentFeed.mockResolvedValue({
      rows: [row()],
      total: 1,
    });

    const response = await call('secret');
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.products[0]).toMatchObject({
      slug: 'aquarium-lighting-led-full-spectrum',
      priceMinor: 2299,
      currency: 'USD',
      // The leaf, not the department: the card still names the specific
      // category the product is filed under. The department is the query.
      category: 'cat-ggl-5079',
      categoryName: 'Aquarium Lighting',
      availability: 'AVAILABLE',
    });
    expect(mocks.readStorefrontDepartmentFeed).toHaveBeenCalledWith(
      'Animals & Pet Supplies',
      // A department scopes on `l1`, so it carries no category path.
      null,
      'newest',
      1,
      30,
      undefined,
      undefined,
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  /**
   * The allow-list boundary. An unrecognised slug must not reach the query at
   * all, and must not be answered with an empty page — that would report a
   * department the taxonomy does not have as one that merely has no stock.
   */
  it('answers 404 for a slug that is not one of the 21 departments', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await call('secret', 'not-a-department');
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({ error: 'Not found' });
    expect(mocks.readStorefrontDepartmentFeed).not.toHaveBeenCalled();
  });

  it('passes the price window and sort through', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontDepartmentFeed.mockResolvedValue({
      rows: [row()],
      total: 31,
    });

    const response = await call(
      'secret',
      'apparel-accessories',
      'sort=price-asc&page=2&limit=10&minPriceMinor=1500&maxPriceMinor=3000',
    );
    const payload = await response.json();

    expect(mocks.readStorefrontDepartmentFeed).toHaveBeenCalledWith(
      'Apparel & Accessories',
      // A department scopes on `l1`, so it carries no category path.
      null,
      'price-asc',
      2,
      10,
      1500,
      3000,
    );
    expect(payload.totalPages).toBe(4);
  });

  /**
   * A browse URL is something a buyer edits, shares, and truncates. Junk
   * degrades to the unfiltered department rather than answering 400.
   */
  it('degrades a junk query string to the default view', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontDepartmentFeed.mockResolvedValue({
      rows: [],
      total: 0,
    });

    await call(
      'secret',
      'animals-pet-supplies',
      'sort=cheapest&page=-4&limit=999&minPriceMinor=abc',
    );

    expect(mocks.readStorefrontDepartmentFeed).toHaveBeenCalledWith(
      'Animals & Pet Supplies',
      // A department scopes on `l1`, so it carries no category path.
      null,
      'newest',
      1,
      30,
      undefined,
      undefined,
    );
  });

  /**
   * Owner decision 2026-08-31: every category level a breadcrumb shows must be
   * clickable, not only the department. `/c/clothing` and `/c/pants` both
   * answered 404 before this — real taxonomy levels with no address.
   */
  it('serves a deeper taxonomy level by its Google id, as a subtree', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontDepartmentFeed.mockResolvedValue({
      rows: [],
      total: 0,
    });

    const response = await call('secret', 'paper-products-956');

    expect(response.status).toBe(200);
    expect(mocks.readStorefrontDepartmentFeed).toHaveBeenCalledWith(
      // No department: a deeper node scopes on its path, not on `l1`.
      null,
      'Office Supplies > General Office Supplies > Paper Products',
      'newest',
      1,
      30,
      undefined,
      undefined,
    );
  });

  it('reads only the id, so the words in front of it are decoration', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontDepartmentFeed.mockResolvedValue({
      rows: [],
      total: 0,
    });

    // A renamed category, or a hand-typed link with the wrong words, still
    // resolves — which is the whole reason the id is in the slug.
    await call('secret', 'totally-wrong-words-956');

    expect(mocks.readStorefrontDepartmentFeed).toHaveBeenCalledWith(
      null,
      'Office Supplies > General Office Supplies > Paper Products',
      'newest',
      1,
      30,
      undefined,
      undefined,
    );
  });

  it('404s an id the taxonomy does not carry, without querying', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await call('secret', 'invented-99999999');

    // The allow-list is the security boundary: nothing a buyer types reaches a
    // query, and answering 200 with an empty page would claim a category exists.
    expect(response.status).toBe(404);
    expect(mocks.readStorefrontDepartmentFeed).not.toHaveBeenCalled();
  });

  it('404s a slug that is neither a department nor an id', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    // `clothing` is a real taxonomy level, and this is why it needs its id: a
    // bare name cannot be resolved back to one row.
    const response = await call('secret', 'clothing');

    expect(response.status).toBe(404);
    expect(mocks.readStorefrontDepartmentFeed).not.toHaveBeenCalled();
  });

  it('returns an empty department rather than an error', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.readStorefrontDepartmentFeed.mockResolvedValue({
      rows: [],
      total: 0,
    });

    const response = await call('secret', 'software');
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      products: [],
      total: 0,
      page: 1,
      limit: 30,
      totalPages: 1,
    });
  });

  it('answers a database failure with a generic 503 and leaks nothing', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.readStorefrontDepartmentFeed.mockRejectedValue(
      new Error('relation "sals3_categories" does not exist'),
    );

    const response = await call('secret');
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Catalog temporarily unavailable' });
    expect(JSON.stringify(payload)).not.toContain('sals3_categories');
  });
});
