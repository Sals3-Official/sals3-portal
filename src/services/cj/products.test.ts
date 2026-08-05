import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCjAccessToken: vi.fn(),
}));

vi.mock('./token', () => ({
  getCjAccessToken: mocks.getCjAccessToken,
}));

const { fetchCjProducts } = await import('./products');

function jsonResponse(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function successBody(overrides: Record<string, unknown> = {}) {
  return {
    code: 200,
    message: 'Success',
    data: {
      pageNum: 1,
      pageSize: 20,
      total: 1000,
      list: [
        {
          pid: 'abc',
          productName: '["名前"]',
          productNameEn: 'Lamp',
          productSku: 'CJ123',
          productImage: 'https://cf.cjdropshipping.com/a.jpg',
          productWeight: '300.00',
          productType: 'ORDINARY_PRODUCT',
          categoryName: 'Lamps',
          categoryId: 'cat-1',
          sellPrice: '5.09',
          listedNum: 3,
          supplierName: 'Someone',
          isFreeShipping: true,
          createTime: 1785921203000,
          shippingCountryCodes: ['CN'],
        },
      ],
      ...overrides,
    },
  };
}

describe('fetchCjProducts', () => {
  afterEach(() => {
    mocks.getCjAccessToken.mockReset();
    vi.unstubAllGlobals();
  });

  it('reports the page-size-derived total pages on a normal page', async () => {
    mocks.getCjAccessToken.mockResolvedValue('token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(successBody())),
    );

    const page = await fetchCjProducts({ cjPage: 1, cjSearch: '' });

    expect(page.products).toHaveLength(1);
    expect(page.totalPages).toBe(50);
  });

  it('self-corrects totalPages when a deep page comes back empty', async () => {
    mocks.getCjAccessToken.mockResolvedValue('token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(successBody({ list: [], pageNum: 19 })),
        ),
    );

    const page = await fetchCjProducts({
      cjPage: 19,
      cjSearch: '',
    });

    expect(page.products).toEqual([]);
    expect(page.totalPages).toBe(18);
  });

  it('self-corrects totalPages when a deep page errors in the response body', async () => {
    mocks.getCjAccessToken.mockResolvedValue('token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ code: 1600100, message: 'Param error', data: null }),
        ),
    );

    const page = await fetchCjProducts({
      cjPage: 19,
      cjSearch: '',
    });

    expect(page.products).toEqual([]);
    expect(page.totalPages).toBe(18);
  });

  it('still throws a typed error for a body-level failure on page 1', async () => {
    mocks.getCjAccessToken.mockResolvedValue('token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ code: 1600100, message: 'Param error', data: null }),
        ),
    );

    await expect(
      fetchCjProducts({ cjPage: 1, cjSearch: '' }),
    ).rejects.toMatchObject({
      name: 'CjApiError',
      reason: 'unexpected-response',
    });
  });

  it('still throws a typed error for an HTTP-level failure, regardless of page', async () => {
    mocks.getCjAccessToken.mockResolvedValue('token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Server error', { status: 500 })),
    );

    await expect(
      fetchCjProducts({ cjPage: 19, cjSearch: '' }),
    ).rejects.toMatchObject({
      name: 'CjApiError',
      reason: 'upstream-unavailable',
    });
  });

  it('still throws a typed error when CJ rate-limits, regardless of page', async () => {
    mocks.getCjAccessToken.mockResolvedValue('token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('Too many requests', { status: 429 })),
    );

    await expect(
      fetchCjProducts({ cjPage: 19, cjSearch: '' }),
    ).rejects.toMatchObject({ name: 'CjApiError', reason: 'rate-limited' });
  });
});
