import { describe, expect, it } from 'vitest';
import {
  allSupplierProductsQuerySchema,
  distinctCurrencies,
  filterProducts,
  NOT_QUEUED_SENTINEL,
  paginate,
  sortProducts,
  usableConnections,
  type AllSupplierProductsQuery,
} from './catalog-filters';
import type {
  SupplierConnectionFixture,
  SupplierProductFixture,
} from './catalog-types';

function connection(
  overrides: Partial<SupplierConnectionFixture> = {},
): SupplierConnectionFixture {
  return {
    id: 'conn-1',
    providerCode: 'CJ_DROPSHIPPING',
    providerDisplayName: 'CJ Dropshipping',
    providerLogoInitial: 'CJ',
    connectedAccountLabel: 'CJ (Test)',
    status: 'CONNECTED',
    lastVerifiedAt: null,
    ...overrides,
  };
}

function product(
  overrides: Partial<SupplierProductFixture> = {},
): SupplierProductFixture {
  return {
    id: 'p-1',
    connectionId: 'conn-1',
    externalProductId: 'EXT-1',
    externalVariantIds: [],
    title: 'Test Product',
    normalizedTitle: null,
    imageUrl: null,
    category: 'Widgets',
    supplierCurrency: 'USD',
    supplierPriceMinor: 1000,
    supplierPriceMaxMinor: null,
    stock: 'IN_STOCK',
    availableVariantCount: 1,
    totalVariantCount: 1,
    shipsFrom: ['CN'],
    eligibleMarkets: ['PH'],
    evaluationStatus: 'PASS',
    evaluationReasonCodes: [],
    lastSupplierUpdateAt: '2026-08-01T00:00:00.000Z',
    lastSyncedAt: '2026-08-01T00:00:00.000Z',
    isStale: false,
    existingListingsCount: 0,
    potentialDuplicateOfIds: [],
    mediaRightsWarning: false,
    restrictedCategoryWarning: false,
    sourceUrl: null,
    ...overrides,
  };
}

function defaultQuery(
  overrides: Partial<AllSupplierProductsQuery> = {},
): AllSupplierProductsQuery {
  return allSupplierProductsQuerySchema.parse(overrides);
}

describe('usableConnections', () => {
  it('keeps CONNECTED and DEGRADED, drops everything else', () => {
    const connections = [
      connection({ id: 'a', status: 'CONNECTED' }),
      connection({ id: 'b', status: 'DEGRADED' }),
      connection({ id: 'c', status: 'PENDING' }),
      connection({ id: 'd', status: 'REAUTH_REQUIRED' }),
      connection({ id: 'e', status: 'DISCONNECTED' }),
      connection({ id: 'f', status: 'REVOKED' }),
    ];

    const usable = usableConnections({
      connections,
      fetchFailures: [],
      products: [],
      key: 'test',
      label: 'Test',
      description: '',
    });

    expect(usable.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('filterProducts', () => {
  it('excludes products sourced from a non-usable connection even if requested by ?supplier=', () => {
    const world = {
      connections: [connection({ id: 'pending-conn', status: 'PENDING' })],
      products: [product({ connectionId: 'pending-conn' })],
    };

    const result = filterProducts(
      world,
      defaultQuery({ supplier: 'pending-conn' }),
    );

    expect(result).toHaveLength(0);
  });

  it('matches the NOT_QUEUED sentinel to products with no evaluation status', () => {
    const world = {
      connections: [connection()],
      products: [
        product({ id: 'queued', evaluationStatus: null }),
        product({ id: 'ready', evaluationStatus: 'PASS' }),
      ],
    };

    const result = filterProducts(
      world,
      defaultQuery({ status: NOT_QUEUED_SENTINEL }),
    );

    expect(result.map((p) => p.id)).toEqual(['queued']);
  });

  it('matches a real evaluation status alongside the sentinel', () => {
    const world = {
      connections: [connection()],
      products: [
        product({ id: 'queued', evaluationStatus: null }),
        product({ id: 'ready', evaluationStatus: 'PASS' }),
        product({ id: 'blocked', evaluationStatus: 'BLOCKED' }),
      ],
    };

    const result = filterProducts(
      world,
      defaultQuery({ status: `${NOT_QUEUED_SENTINEL},PASS` }),
    );

    expect(result.map((p) => p.id).sort()).toEqual(['queued', 'ready']);
  });

  it('filters by stock, ships-from, market, and listing state', () => {
    const world = {
      connections: [connection()],
      products: [
        product({
          id: 'match',
          stock: 'IN_STOCK',
          shipsFrom: ['CN'],
          eligibleMarkets: ['PH'],
          existingListingsCount: 0,
        }),
        product({
          id: 'wrong-stock',
          stock: 'OUT_OF_STOCK',
          shipsFrom: ['CN'],
          eligibleMarkets: ['PH'],
        }),
        product({
          id: 'wrong-origin',
          stock: 'IN_STOCK',
          shipsFrom: ['US'],
          eligibleMarkets: ['PH'],
        }),
        product({
          id: 'wrong-market',
          stock: 'IN_STOCK',
          shipsFrom: ['CN'],
          eligibleMarkets: ['SG'],
        }),
        product({
          id: 'has-listing',
          stock: 'IN_STOCK',
          shipsFrom: ['CN'],
          eligibleMarkets: ['PH'],
          existingListingsCount: 1,
        }),
      ],
    };

    const result = filterProducts(
      world,
      defaultQuery({
        stock: 'IN_STOCK',
        shipsFrom: 'CN',
        market: 'PH',
        listing: 'NOT_LISTED',
      }),
    );

    expect(result.map((p) => p.id)).toEqual(['match']);
  });

  it('matches search across title, normalized title, external ID, and category', () => {
    const world = {
      connections: [connection()],
      products: [
        product({ id: 'a', title: 'Bamboo Desk Organizer' }),
        product({
          id: 'b',
          title: 'x',
          normalizedTitle: 'Coffee Dripper Set',
        }),
        product({ id: 'c', title: 'x', externalProductId: 'CJYD9999' }),
        product({ id: 'd', title: 'x', category: 'Kitchen Tools' }),
        product({ id: 'e', title: 'unrelated' }),
      ],
    };

    expect(
      filterProducts(world, defaultQuery({ q: 'bamboo' })).map((p) => p.id),
    ).toEqual(['a']);
    expect(
      filterProducts(world, defaultQuery({ q: 'dripper' })).map((p) => p.id),
    ).toEqual(['b']);
    expect(
      filterProducts(world, defaultQuery({ q: 'CJYD9999' })).map((p) => p.id),
    ).toEqual(['c']);
    expect(
      filterProducts(world, defaultQuery({ q: 'kitchen' })).map((p) => p.id),
    ).toEqual(['d']);
  });
});

describe('sortProducts', () => {
  it('sorts by supplier price only within the same currency', () => {
    const products = [
      product({
        id: 'usd-high',
        supplierCurrency: 'USD',
        supplierPriceMinor: 900,
      }),
      product({
        id: 'usd-low',
        supplierCurrency: 'USD',
        supplierPriceMinor: 100,
      }),
      product({
        id: 'aud-mid',
        supplierCurrency: 'AUD',
        supplierPriceMinor: 500,
      }),
    ];

    const sorted = sortProducts(products, 'price-asc');
    const usdOnly = sorted.filter((p) => p.supplierCurrency === 'USD');

    // Same-currency rows are genuinely ordered low to high.
    expect(usdOnly.map((p) => p.id)).toEqual(['usd-low', 'usd-high']);
    // Cross-currency comparisons never throw and every row survives the sort.
    expect(sorted).toHaveLength(3);
  });

  it('ranks blockers before ready products under evaluation-status sort', () => {
    const products = [
      product({ id: 'ready', evaluationStatus: 'PASS' }),
      product({ id: 'blocked', evaluationStatus: 'BLOCKED' }),
      product({ id: 'not-queued', evaluationStatus: null }),
    ];

    const sorted = sortProducts(products, 'evaluation-status');

    expect(sorted.map((p) => p.id)).toEqual(['blocked', 'not-queued', 'ready']);
  });
});

describe('distinctCurrencies', () => {
  it('returns each supplier currency once', () => {
    const products = [
      product({ supplierCurrency: 'USD' }),
      product({ supplierCurrency: 'USD' }),
      product({ supplierCurrency: 'AUD' }),
    ];

    expect(distinctCurrencies(products).sort()).toEqual(['AUD', 'USD']);
  });
});

describe('paginate', () => {
  it('splits items into pages and clamps an out-of-range page number', () => {
    const items = Array.from({ length: 10 }, (_, index) => index);

    const first = paginate(items, 1, 4);
    expect(first.pageItems).toEqual([0, 1, 2, 3]);
    expect(first.totalPages).toBe(3);

    const clamped = paginate(items, 99, 4);
    expect(clamped.page).toBe(3);
    expect(clamped.pageItems).toEqual([8, 9]);
  });

  it('never reports zero pages for an empty list', () => {
    expect(paginate([], 1).totalPages).toBe(1);
  });
});
