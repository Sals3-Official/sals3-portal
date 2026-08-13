import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({}),
  isDatabaseConfigured: () => true,
}));

vi.mock('../../repository', () => ({
  updateConnectionHealth: vi.fn(),
}));

// eslint-disable-next-line import/first
import type { SupplierSecretStore } from '@/lib/secrets/supplier-secret-store';
// eslint-disable-next-line import/first
import { CjApiError } from '@/services/cj/config';
// eslint-disable-next-line import/first
import CjSupplierAdapter from './cj-adapter';
// eslint-disable-next-line import/first
import type CjTokenManager from './cj-auth';

const tokenManager = {
  getAccessToken: vi.fn().mockResolvedValue('token-1'),
} as unknown as CjTokenManager;

const secretStore = {} as SupplierSecretStore;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn();

function adapter(): CjSupplierAdapter {
  return new CjSupplierAdapter(
    secretStore,
    tokenManager,
    fetchMock as unknown as typeof fetch,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('listBrowsePage - the seller-facing live browse read', () => {
  it('sends only pageNum/pageSize when no filter is chosen (provider default ranking)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        code: 200,
        message: 'ok',
        data: { pageNum: 1, pageSize: 200, total: 0, list: [] },
      }),
    );

    await adapter().listBrowsePage('connection-1', {
      pageNum: 1,
      pageSize: 200,
    });

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname.endsWith('/product/list')).toBe(true);
    expect(url.pathname).not.toContain('listV2');
    expect([...url.searchParams.keys()].sort()).toEqual([
      'pageNum',
      'pageSize',
    ]);
    expect(url.searchParams.get('pageNum')).toBe('1');
    expect(url.searchParams.get('pageSize')).toBe('200');
  });

  it('maps search/category/ordering to the documented legacy filters only when set', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        code: 200,
        message: 'ok',
        data: { pageNum: 2, pageSize: 200, total: 1, list: [] },
      }),
    );

    await adapter().listBrowsePage('connection-1', {
      pageNum: 2,
      pageSize: 200,
      search: 'cat toy',
      categoryId: 'cat-9',
      orderBy: 'listedNum',
      sort: 'desc',
    });

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get('productNameEn')).toBe('cat toy');
    expect(url.searchParams.get('categoryId')).toBe('cat-9');
    expect(url.searchParams.get('orderBy')).toBe('listedNum');
    expect(url.searchParams.get('sort')).toBe('desc');
  });

  it('omits an empty search and empty category id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        code: 200,
        message: 'ok',
        data: { pageNum: 1, pageSize: 200, total: 0, list: [] },
      }),
    );

    await adapter().listBrowsePage('connection-1', {
      pageNum: 1,
      pageSize: 200,
      search: '',
      categoryId: '',
    });

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.has('productNameEn')).toBe(false);
    expect(url.searchParams.has('categoryId')).toBe(false);
  });

  it('refuses a page size beyond the documented 200 maximum before any request', async () => {
    await expect(
      adapter().listBrowsePage('connection-1', { pageNum: 1, pageSize: 201 }),
    ).rejects.toThrow(CjApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a 429 response to rate-limited', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 429));

    await expect(
      adapter().listBrowsePage('connection-1', { pageNum: 1, pageSize: 200 }),
    ).rejects.toMatchObject({ reason: 'rate-limited' });
  });

  it('maps network and timeout failures to upstream-unavailable', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));

    await expect(
      adapter().listBrowsePage('connection-1', { pageNum: 1, pageSize: 200 }),
    ).rejects.toMatchObject({ reason: 'upstream-unavailable' });
  });

  it('maps an envelope code 401 to authentication-failed', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 401, message: 'expired' }),
    );

    await expect(
      adapter().listBrowsePage('connection-1', { pageNum: 1, pageSize: 200 }),
    ).rejects.toMatchObject({ reason: 'authentication-failed' });
  });

  it('maps a malformed body to unexpected-response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ nonsense: true }));

    await expect(
      adapter().listBrowsePage('connection-1', { pageNum: 1, pageSize: 200 }),
    ).rejects.toMatchObject({ reason: 'unexpected-response' });
  });

  it('normalizes products and derives total pages from the provider values', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        code: 200,
        message: 'ok',
        data: {
          pageNum: 1,
          pageSize: 200,
          total: 401,
          list: [
            {
              pid: 'pid-1',
              productNameEn: 'Cat Toy',
              productSku: 'SKU-1',
              productImage: 'https://cf.cjdropshipping.com/img.jpg',
              productWeight: '100',
              productType: null,
              categoryName: 'Pet Toy Set',
              categoryId: 'cat-9',
              sellPrice: '9.68',
              listedNum: 4000,
              supplierName: null,
              isFreeShipping: false,
              createTime: 1_700_000_000_000,
              shippingCountryCodes: ['CN'],
            },
          ],
        },
      }),
    );

    const page = await adapter().listBrowsePage('connection-1', {
      pageNum: 1,
      pageSize: 200,
    });

    expect(page.totalPages).toBe(3);
    expect(page.products).toHaveLength(1);
    expect(page.products[0]).toMatchObject({
      id: 'pid-1',
      name: 'Cat Toy',
      priceCentsUsd: 968,
    });
  });
});
