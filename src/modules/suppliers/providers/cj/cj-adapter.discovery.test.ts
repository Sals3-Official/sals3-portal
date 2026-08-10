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

describe('listCatalogPage - the legacy discovery contract', () => {
  it('sends only documented legacy filters with the fixed deterministic ordering', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        code: 200,
        message: 'ok',
        pointsInfo: { total: 50_000, usedToday: 50, remaining: 49_950 },
        data: { pageNum: 1, pageSize: 200, total: 2, list: [] },
      }),
    );

    await adapter().listCatalogPage('connection-1', {
      pageNum: 1,
      pageSize: 200,
      categoryId: 'cat-1',
      createTimeFrom: '2016-01-01 00:00:00',
      createTimeTo: '2026-08-11 00:00:00',
      minPrice: 10,
      maxPrice: 20.5,
    });

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname.endsWith('/product/list')).toBe(true);
    expect(url.pathname).not.toContain('listV2');
    expect(url.searchParams.get('pageNum')).toBe('1');
    expect(url.searchParams.get('pageSize')).toBe('200');
    expect(url.searchParams.get('orderBy')).toBe('createAt');
    expect(url.searchParams.get('sort')).toBe('asc');
    expect(url.searchParams.get('categoryId')).toBe('cat-1');
    expect(url.searchParams.get('createTimeFrom')).toBe('2016-01-01 00:00:00');
    expect(url.searchParams.get('createTimeTo')).toBe('2026-08-11 00:00:00');
    expect(url.searchParams.get('minPrice')).toBe('10.00');
    expect(url.searchParams.get('maxPrice')).toBe('20.50');
  });

  it('returns provider paging metadata, derived total pages, and pointsInfo untouched', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        code: 200,
        message: 'ok',
        pointsInfo: { total: 50_000, usedToday: 100, remaining: 49_900 },
        data: { pageNum: 3, pageSize: 200, total: 6_000, list: [] },
      }),
    );

    const page = await adapter().listCatalogPage('connection-1', {
      pageNum: 3,
      pageSize: 200,
    });

    expect(page.requestedPageNum).toBe(3);
    expect(page.pageNum).toBe(3);
    expect(page.total).toBe(6_000);
    // Derived from the provider's own values - and a 6,000 total is plain
    // data, not an error or a cap.
    expect(page.totalPages).toBe(30);
    expect(page.pointsInfo).toEqual({
      total: 50_000,
      usedToday: 100,
      remaining: 49_900,
    });
  });

  it('refuses a page size beyond the documented 200 maximum before any request', async () => {
    await expect(
      adapter().listCatalogPage('connection-1', { pageNum: 1, pageSize: 201 }),
    ).rejects.toThrow(CjApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getCategoryTree', () => {
  it('flattens the documented three-level tree to leaves keyed by provider category id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        code: 200,
        message: 'ok',
        data: [
          {
            categoryFirstName: 'Phones',
            categoryFirstList: [
              {
                categorySecondName: 'Accessories',
                categorySecondList: [
                  { categoryId: 'cat-1', categoryName: 'Cases' },
                  { categoryId: '', categoryName: 'No-id leaf (dropped)' },
                ],
              },
            ],
          },
        ],
      }),
    );

    const leaves = await adapter().getCategoryTree('connection-1');

    expect(leaves).toEqual([
      {
        categoryId: 'cat-1',
        categoryName: 'Cases',
        path: ['Phones', 'Accessories'],
      },
    ]);
  });
});

describe('subscription mutations', () => {
  it('enforces the documented 100-id maximum per subscribe request', async () => {
    await expect(
      adapter().subscribeProducts(
        'connection-1',
        Array.from({ length: 101 }, (_, i) => `pid-${i}`),
      ),
    ).rejects.toThrow(CjApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs explicit product ids - never subscribeAll', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 200, message: 'ok' }));

    await adapter().subscribeProducts('connection-1', ['pid-1', 'pid-2']);

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url.endsWith('/webhook/product/subscribe')).toBe(true);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ productIds: ['pid-1', 'pid-2'] });
    expect(JSON.stringify(body)).not.toContain('subscribeAll');
  });

  it('is a no-op for an empty id list', async () => {
    await adapter().subscribeProducts('connection-1', []);
    await adapter().unsubscribeProducts('connection-1', []);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('setWebhookCallback', () => {
  it('refuses a non-HTTPS callback URL before any request', async () => {
    await expect(
      adapter().setWebhookCallback('connection-1', {
        callbackUrl: 'http://insecure.example.com/webhook',
        topics: [{ topic: 'product', enabled: true }],
      }),
    ).rejects.toThrow(CjApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends per-topic ENABLE/CANCEL with the single callback URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 200, message: 'ok' }));

    await adapter().setWebhookCallback('connection-1', {
      callbackUrl: 'https://portal.example.com/api/webhooks/cj',
      topics: [
        { topic: 'product', enabled: true },
        { topic: 'stock', enabled: false },
      ],
    });

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url.endsWith('/webhook/set')).toBe(true);
    const body = JSON.parse(init.body as string) as Record<
      string,
      { type: string; callbackUrls: string[] }
    >;
    expect(body.product).toEqual({
      type: 'ENABLE',
      callbackUrls: ['https://portal.example.com/api/webhooks/cj'],
    });
    expect(body.stock).toEqual({
      type: 'CANCEL',
      callbackUrls: ['https://portal.example.com/api/webhooks/cj'],
    });
  });
});
