import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findConnectionBySellerAndProviderMock,
  findEvaluationsByExternalIdsMock,
  findProviderByCodeMock,
  getDbMock,
  isDatabaseConfiguredMock,
  listCandidatesMock,
  requireDropshipperAccountMock,
  resolveUsdToAudMidRateMock,
} = vi.hoisted(() => ({
  findConnectionBySellerAndProviderMock: vi.fn(),
  findEvaluationsByExternalIdsMock: vi.fn(),
  findProviderByCodeMock: vi.fn(),
  getDbMock: vi.fn(() => ({})),
  isDatabaseConfiguredMock: vi.fn(),
  listCandidatesMock: vi.fn(),
  requireDropshipperAccountMock: vi.fn(),
  resolveUsdToAudMidRateMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  default: getDbMock,
  isDatabaseConfigured: isDatabaseConfiguredMock,
}));

vi.mock('@/lib/auth/seller-guard', () => ({
  requireDropshipperAccount: requireDropshipperAccountMock,
}));

vi.mock('@/lib/products/catalog-fx', () => ({
  resolveUsdToAudMidRate: resolveUsdToAudMidRateMock,
}));

vi.mock('@/modules/catalog/candidates/queries', () => ({
  findEvaluationsByExternalIds: findEvaluationsByExternalIdsMock,
}));

vi.mock('@/modules/catalog/discovery/control', () => ({
  ensureDiscoveryChainOnAuthorizedLoad: vi.fn(),
}));

vi.mock('@/modules/suppliers/repository', () => ({
  findConnectionBySellerAndProvider: findConnectionBySellerAndProviderMock,
  findProviderByCode: findProviderByCodeMock,
  isWorkableConnectionStatus: (status: string) =>
    status === 'CONNECTED' || status === 'DEGRADED',
}));

vi.mock('@/lib/secrets/postgres-supplier-secret-store', () => ({
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

vi.mock('@/modules/suppliers/providers/cj/cj-adapter', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  default: vi.fn().mockImplementation(function MockCjSupplierAdapter() {
    return { listCandidates: listCandidatesMock };
  }),
}));

vi.mock('./CjProductsTable', () => ({
  default: ({
    evaluations,
    products,
  }: {
    evaluations: Map<string, unknown>;
    products: Array<{ name: string }>;
  }) => (
    <div>
      <p>evaluation-count:{evaluations.size}</p>
      {products.map((product) => (
        <p key={product.name}>{product.name}</p>
      ))}
    </div>
  ),
}));

vi.mock('./CjProductGrid', () => ({
  default: () => <div>grid view</div>,
}));

vi.mock('./CjPagination', () => ({
  default: () => <nav>pagination</nav>,
}));

vi.mock('./CjSearchInput', () => ({
  default: () => <input aria-label="Search CJ products" />,
}));

vi.mock('./CjStatHeader', () => ({
  default: () => <div>stats</div>,
}));

vi.mock('./CjViewToggle', () => ({
  default: () => <div>view toggle</div>,
}));

// eslint-disable-next-line import/first
import CjCatalogueView from './CjCatalogueView';

const SELLER_ACCOUNT = {
  id: 'seller-1',
  identityId: 'user-1',
  businessModel: 'DROPSHIPPER',
  verificationState: 'VERIFIED',
  accountState: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const PROVIDER = {
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

const CONNECTION = {
  id: 'connection-1',
  sellerAccountId: SELLER_ACCOUNT.id,
  providerId: PROVIDER.id,
  displayName: 'CJ Dropshipping',
  externalAccountLookupHash: 'hash',
  externalAccountMasked: 'CJ...1234',
  status: 'CONNECTED',
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  lastVerifiedAt: null,
  lastErrorCode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  disconnectedAt: null,
};

const PRODUCT = {
  id: 'CJ-PID-1',
  name: 'Supplier product that still renders',
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

const QUERY = {
  cjPage: 1,
  cjSearch: '',
  cjPid: '',
  view: 'table' as const,
};

describe('CjCatalogueView', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    isDatabaseConfiguredMock.mockReset().mockReturnValue(true);
    requireDropshipperAccountMock
      .mockReset()
      .mockResolvedValue({ sellerAccount: SELLER_ACCOUNT });
    findProviderByCodeMock.mockReset().mockResolvedValue(PROVIDER);
    findConnectionBySellerAndProviderMock
      .mockReset()
      .mockResolvedValue(CONNECTION);
    resolveUsdToAudMidRateMock.mockReset().mockResolvedValue({
      rate: 1.5,
      fetchedAt: new Date('2026-08-11T00:00:00.000Z'),
      stale: false,
    });
    listCandidatesMock.mockReset().mockResolvedValue({
      products: [PRODUCT],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    });
    findEvaluationsByExternalIdsMock.mockReset().mockResolvedValue(new Map());
  });

  it('renders supplier products without statuses when evaluation lookup fails', async () => {
    findEvaluationsByExternalIdsMock.mockRejectedValue(
      new Error('column "next_refresh_at" does not exist'),
    );

    render(await CjCatalogueView({ query: QUERY }));

    expect(
      screen.getByText('Supplier product that still renders'),
    ).toBeInTheDocument();
    expect(screen.getByText('evaluation-count:0')).toBeInTheDocument();
    // eslint-disable-next-line no-console
    expect(console.error).toHaveBeenCalledWith(
      '[portal] CJ evaluation lookup failed',
      'column "next_refresh_at" does not exist',
    );
  });
});
