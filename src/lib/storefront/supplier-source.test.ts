import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(() => ({})),
}));

vi.mock('@/lib/db/client', () => ({
  default: getDbMock,
  isDatabaseConfigured: vi.fn(),
}));

vi.mock('@/modules/suppliers/repository', () => ({
  findSellerAccountByIdentityId: vi.fn(),
  findProviderByCode: vi.fn(),
  findConnectionBySellerAndProvider: vi.fn(),
  // Real predicate logic so status cases exercise the actual policy.
  isWorkableConnectionStatus: (status: string) =>
    status === 'CONNECTED' || status === 'DEGRADED',
}));

vi.mock('@/lib/secrets/postgres-supplier-secret-store', () => ({
  // A real `function` is required, not an arrow function - the code under
  // test calls `new PostgresSupplierSecretStore()`, and arrow functions can
  // never be constructors.
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn().mockImplementation(function MockClass() {
    return {};
  }),
}));

vi.mock('@/modules/suppliers/providers/cj/cj-auth', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn().mockImplementation(function MockClass() {
    return {};
  }),
}));

const { listCandidatesMock } = vi.hoisted(() => ({
  listCandidatesMock: vi.fn(),
}));

vi.mock('@/modules/suppliers/providers/cj/cj-adapter', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn().mockImplementation(function MockCjSupplierAdapter() {
    return { listCandidates: listCandidatesMock };
  }),
}));

// eslint-disable-next-line import/first
import { isDatabaseConfigured } from '@/lib/db/client';
// eslint-disable-next-line import/first
import type {
  SellerAccountRow,
  SupplierConnectionRow,
  SupplierProviderRow,
} from '@/lib/db/schema';
// eslint-disable-next-line import/first
import {
  findConnectionBySellerAndProvider,
  findProviderByCode,
  findSellerAccountByIdentityId,
} from '@/modules/suppliers/repository';
// eslint-disable-next-line import/first
import type { CjProduct } from '@/lib/cj/normalize';
// eslint-disable-next-line import/first
import { CjApiError } from '@/services/cj/config';
// eslint-disable-next-line import/first
import {
  fetchStorefrontCjProducts,
  type CjProductPage,
} from './supplier-source';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SELLER: SellerAccountRow = {
  id: 'seller-account-1',
  identityId: 'dev-user',
  businessModel: 'DROPSHIPPER',
  verificationState: 'VERIFIED',
  accountState: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const PROVIDER: SupplierProviderRow = {
  id: 'provider-1',
  code: 'CJ_DROPSHIPPING',
  displayName: 'CJdropshipping',
  status: 'ACTIVE',
  capabilities: {
    catalog: true,
    inventory: true,
    productWebhooks: false,
    orderSubmission: false,
    orderWebhooks: false,
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

function connectionWithStatus(
  status: SupplierConnectionRow['status'],
): SupplierConnectionRow {
  return {
    id: 'connection-1',
    sellerAccountId: SELLER.id,
    providerId: PROVIDER.id,
    displayName: 'CJ Dropshipping (Sals3 Official)',
    externalAccountLookupHash: 'hash',
    externalAccountMasked: 'CJ...1234',
    status,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    lastVerifiedAt: null,
    lastErrorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    disconnectedAt: null,
  };
}

const PRODUCT: CjProduct = {
  id: 'CJLY1',
  name: 'Plain phone case',
  sku: 'SKU-1',
  imageUrl: null,
  category: 'Phone accessories',
  priceCentsUsd: 500,
  weight: '100 g',
  productType: 'accessory',
  supplier: 'CJ',
  freeShipping: false,
  shipsFrom: ['CN'],
  listedCount: 10,
  createdAt: null,
};

function pageOf(overrides: Partial<CjProductPage> = {}): CjProductPage {
  return {
    products: [],
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
    ...overrides,
  };
}

const QUERY = { cjPage: 1, cjSearch: '', cjPid: '' };

describe('fetchStorefrontCjProducts', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getDbMock.mockClear();
    asMock(isDatabaseConfigured).mockReset().mockReturnValue(true);
    asMock(findSellerAccountByIdentityId).mockReset().mockResolvedValue(SELLER);
    asMock(findProviderByCode).mockReset().mockResolvedValue(PROVIDER);
    asMock(findConnectionBySellerAndProvider)
      .mockReset()
      .mockResolvedValue(connectionWithStatus('CONNECTED'));
    listCandidatesMock.mockReset();
  });

  it('fetches through the official connection with the mapped query', async () => {
    const page = pageOf({
      products: [PRODUCT],
      page: 3,
      total: 41,
      totalPages: 3,
    });
    listCandidatesMock.mockResolvedValue(page);

    await expect(
      fetchStorefrontCjProducts({ cjPage: 3, cjSearch: 'case', cjPid: 'pid' }),
    ).resolves.toEqual(page);

    expect(findSellerAccountByIdentityId).toHaveBeenCalledWith(
      expect.anything(),
      'dev-user',
    );
    expect(listCandidatesMock).toHaveBeenCalledWith('connection-1', {
      page: 3,
      search: 'case',
      pid: 'pid',
    });
  });

  it('reports missing credentials without touching the DB when it is not configured', async () => {
    asMock(isDatabaseConfigured).mockReturnValue(false);

    await expect(fetchStorefrontCjProducts(QUERY)).rejects.toMatchObject({
      reason: 'missing-credentials',
    });
    expect(getDbMock).not.toHaveBeenCalled();
    expect(listCandidatesMock).not.toHaveBeenCalled();
  });

  it('reports missing credentials when the official seller account is absent', async () => {
    asMock(findSellerAccountByIdentityId).mockResolvedValue(null);

    await expect(fetchStorefrontCjProducts(QUERY)).rejects.toMatchObject({
      reason: 'missing-credentials',
    });
  });

  it('reports missing credentials when the CJ provider is not seeded', async () => {
    asMock(findProviderByCode).mockResolvedValue(null);

    await expect(fetchStorefrontCjProducts(QUERY)).rejects.toMatchObject({
      reason: 'missing-credentials',
    });
  });

  it('reports missing credentials when the official seller has no connection', async () => {
    asMock(findConnectionBySellerAndProvider).mockResolvedValue(null);

    await expect(fetchStorefrontCjProducts(QUERY)).rejects.toMatchObject({
      reason: 'missing-credentials',
    });
  });

  it.each(['REVOKED', 'DISCONNECTED', 'REAUTH_REQUIRED', 'PENDING'] as const)(
    'reports missing credentials when the connection is %s',
    async (status) => {
      asMock(findConnectionBySellerAndProvider).mockResolvedValue(
        connectionWithStatus(status),
      );

      await expect(fetchStorefrontCjProducts(QUERY)).rejects.toMatchObject({
        reason: 'missing-credentials',
      });
      expect(listCandidatesMock).not.toHaveBeenCalled();
    },
  );

  it('still fetches through a DEGRADED connection', async () => {
    asMock(findConnectionBySellerAndProvider).mockResolvedValue(
      connectionWithStatus('DEGRADED'),
    );
    listCandidatesMock.mockResolvedValue(pageOf());

    await expect(fetchStorefrontCjProducts(QUERY)).resolves.toEqual(pageOf());
  });

  it('maps a DB failure during resolution to upstream-unavailable', async () => {
    asMock(findSellerAccountByIdentityId).mockRejectedValue(
      new Error('connection refused'),
    );

    await expect(fetchStorefrontCjProducts(QUERY)).rejects.toMatchObject({
      reason: 'upstream-unavailable',
    });
  });

  it('returns an empty synthetic page for a body-level error past page 1', async () => {
    listCandidatesMock.mockRejectedValue(new CjApiError('unexpected-response'));

    await expect(
      fetchStorefrontCjProducts({ cjPage: 3, cjSearch: '', cjPid: '' }),
    ).resolves.toEqual({
      products: [],
      page: 3,
      pageSize: 20,
      total: 40,
      totalPages: 2,
    });
  });

  it('still reports a body-level error on page 1', async () => {
    listCandidatesMock.mockRejectedValue(new CjApiError('unexpected-response'));

    await expect(fetchStorefrontCjProducts(QUERY)).rejects.toMatchObject({
      reason: 'unexpected-response',
    });
  });

  it('rethrows rate limiting unchanged, even past page 1', async () => {
    listCandidatesMock.mockRejectedValue(new CjApiError('rate-limited'));

    await expect(
      fetchStorefrontCjProducts({ cjPage: 3, cjSearch: '', cjPid: '' }),
    ).rejects.toMatchObject({ reason: 'rate-limited' });
  });

  it('returns an empty synthetic page when a page past 1 has no products', async () => {
    listCandidatesMock.mockResolvedValue(
      pageOf({ page: 4, total: 60, totalPages: 3 }),
    );

    await expect(
      fetchStorefrontCjProducts({ cjPage: 4, cjSearch: '', cjPid: '' }),
    ).resolves.toEqual({
      products: [],
      page: 4,
      pageSize: 20,
      total: 60,
      totalPages: 3,
    });
  });

  it('caps totalPages at 500', async () => {
    listCandidatesMock.mockResolvedValue(
      pageOf({
        products: [PRODUCT],
        total: 1_000_000,
        totalPages: 50_000,
      }),
    );

    await expect(fetchStorefrontCjProducts(QUERY)).resolves.toMatchObject({
      totalPages: 500,
    });
  });

  it('maps an unexpected adapter failure to upstream-unavailable', async () => {
    listCandidatesMock.mockRejectedValue(new Error('socket hang up'));

    await expect(fetchStorefrontCjProducts(QUERY)).rejects.toMatchObject({
      reason: 'upstream-unavailable',
    });
  });
});
