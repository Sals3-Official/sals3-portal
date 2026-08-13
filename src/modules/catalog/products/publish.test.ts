// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  productMediaSources,
  productRevisions,
  products,
  productVariants,
  sals3Categories,
} from '@/lib/db/schema';

const mocks = vi.hoisted(() => ({
  findActiveProfileForSeller: vi.fn(),
  findAuthorizedDestination: vi.fn(),
  isAuthorizedSellingCurrency: vi.fn(),
  resolveSellerMarketCapabilities: vi.fn(),
  resolveProductPricing: vi.fn(),
  projectSupplierMedia: vi.fn(),
  appendAuditEvent: vi.fn(),
}));

vi.mock('@/modules/market-config/repository', () => ({
  findActiveProfileForSeller: mocks.findActiveProfileForSeller,
}));

vi.mock('@/modules/market-config/capabilities', () => ({
  findAuthorizedDestination: mocks.findAuthorizedDestination,
  isAuthorizedSellingCurrency: mocks.isAuthorizedSellingCurrency,
  resolveSellerMarketCapabilities: mocks.resolveSellerMarketCapabilities,
}));

vi.mock('@/modules/pricing/resolver', () => ({
  resolveProductPricing: mocks.resolveProductPricing,
}));

vi.mock('./media-projection', () => ({
  projectSupplierMediaForProduct: mocks.projectSupplierMedia,
  SUPPLIER_MEDIA_RIGHTS: {
    rightsBasis: 'SUPPLIER_TERMS',
    reviewState: 'APPROVED',
  },
}));

vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));

const publishProduct = (await import('./publish')).default;

const PRODUCT_ID = '90a329b9-56aa-4f54-abb2-ad843602aa73';
const SELLER_ID = '843af4aa-725d-4728-bc46-334582566033';

const PROFILE = {
  id: 'profile-1',
  destinationCountryCode: 'AU',
};

const DESTINATION = {
  destinationCountryCode: 'AU',
  destinationName: 'Australia',
  readiness: 'BOUNDED_PILOT' as const,
  authorizedSellingCurrencyCodes: ['USD'],
  pendingCapabilities: [],
};

const PRICED = {
  outcome: 'PRODUCT_MARGIN_ESTIMATE' as const,
  resolvedLayer: 'CATEGORY' as const,
  roundedSuggestedItemPrice: { amountMinor: 4299, currency: 'USD' },
  resolverVersion: 'pricing-resolver-v2',
};

type Overrides = {
  product?: Record<string, unknown> | undefined;
  variants?: Record<string, unknown>[];
  approvedMedia?: unknown[];
  revisions?: Record<string, unknown>[];
};

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    title: 'Waterproof Shell Jacket',
    slug: null,
    version: 1,
    categoryId: 'cat-1',
    categoryCode: 'CAT-APP-100412',
    confidence: 'EXACT',
    currentRevisionId: 'rev-1',
    ...overrides,
  };
}

function variantRow(overrides: Record<string, unknown> = {}) {
  return {
    variantId: 'variant-1',
    sku: 'SALS3-1',
    supplierCandidateId: 'candidate-1',
    supplierVariantId: 'vid-1',
    // `bigint` mode on the column, as a string because that is what
    // postgres.js returns and what the module must therefore tolerate.
    costMinor: '796',
    costCurrency: 'USD',
    inventory: 36,
    observedAt: new Date(),
    bindingState: 'ACTIVE',
    ...overrides,
  };
}

/**
 * Dispatches each read on the table it targets, so a refusal ordering change
 * does not silently answer the wrong query. Writes are recorded rather than
 * applied — every assertion below is about what the module decided, not about
 * Postgres.
 */
function transactionalDb(overrides: Overrides = {}) {
  const writes: { table: unknown; values: unknown }[] = [];

  const rowsForTable = (table: unknown): unknown[] => {
    if (table === products) {
      return overrides.product === undefined
        ? [productRow()]
        : [overrides.product];
    }

    if (table === productVariants) return overrides.variants ?? [variantRow()];
    if (table === productMediaSources) {
      return overrides.approvedMedia ?? [{ id: 'media-1' }];
    }

    if (table === productRevisions) {
      return (
        overrides.revisions ?? [
          {
            id: 'rev-1',
            workflowState: 'DRAFT',
            contentDocument: { version: 1, blocks: [] },
          },
        ]
      );
    }

    return [];
  };

  const selectChain = () => {
    let rows: unknown[] = [];
    const builder: Record<string, unknown> = {};

    builder.from = vi.fn((table: unknown) => {
      rows = rowsForTable(table);

      return builder;
    });
    ['leftJoin', 'innerJoin', 'where', 'groupBy', 'orderBy'].forEach((name) => {
      builder[name] = vi.fn(() => builder);
    });
    builder.limit = vi.fn(() => rows);
    builder.then = (resolve: (value: unknown) => unknown) => resolve(rows);

    return builder;
  };

  const tx = {
    select: vi.fn(selectChain),
    insert: vi.fn((table: unknown) => {
      const chain: Record<string, unknown> = {};

      chain.values = vi.fn((values: unknown) => {
        writes.push({ table, values });

        return chain;
      });
      chain.onConflictDoUpdate = vi.fn(() => chain);
      chain.returning = vi.fn(() => Promise.resolve([{ id: 'offer-1' }]));

      return chain;
    }),
    update: vi.fn((table: unknown) => {
      const chain: Record<string, unknown> = {};

      chain.set = vi.fn((values: unknown) => {
        writes.push({ table, values });

        return chain;
      });
      chain.where = vi.fn(() => chain);
      chain.returning = vi.fn(() =>
        Promise.resolve([{ id: PRODUCT_ID, slug: 'waterproof-shell-jacket' }]),
      );
      chain.then = (resolve: (value: unknown) => unknown) => resolve(undefined);

      return chain;
    }),
  };

  const db = {
    transaction: vi.fn(
      async (callback: (executor: unknown) => Promise<unknown>) => callback(tx),
    ),
    // The pre-transaction reads go through the same dispatcher.
    select: vi.fn(selectChain),
  };

  return { db, tx, writes };
}

function publish(db: unknown, expectedProductVersion = 1) {
  return publishProduct({
    productId: PRODUCT_ID,
    sellerAccountId: SELLER_ID,
    actorId: 'actor-1',
    expectedProductVersion,
    db: db as never,
  });
}

describe('publishProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findActiveProfileForSeller.mockResolvedValue(PROFILE);
    mocks.findAuthorizedDestination.mockReturnValue(DESTINATION);
    mocks.isAuthorizedSellingCurrency.mockReturnValue(true);
    mocks.resolveSellerMarketCapabilities.mockReturnValue({
      capabilityVersion: 'seller-market-capability-v2-au-ph-usd-publishable',
    });
    mocks.resolveProductPricing.mockResolvedValue(PRICED);
    mocks.projectSupplierMedia.mockResolvedValue({
      inserted: 1,
      skipped: 0,
      source: 'DETAIL_EVIDENCE',
    });
  });

  it('publishes a product that satisfies every gate', async () => {
    const { db, writes } = transactionalDb();

    const result = await publish(db);

    expect(result).toMatchObject({
      ok: true,
      slug: 'waterproof-shell-jacket',
      availability: 'AVAILABLE',
    });
    // The publication flip and the slug are one statement: the unique index is
    // partial over PUBLISHED rows, so a separate slug write could not conflict.
    const productWrite = writes.find((write) => write.table === products)
      ?.values as Record<string, unknown>;

    expect(productWrite).toMatchObject({
      slug: 'waterproof-shell-jacket',
      publicationState: 'PUBLISHED',
      version: 2,
    });
  });

  it('freezes the draft revision with a recorded approval mode', async () => {
    const { db, writes } = transactionalDb();

    await publish(db);

    const revisionWrite = writes.find(
      (write) => write.table === productRevisions,
    )?.values as Record<string, unknown>;

    expect(revisionWrite).toMatchObject({
      workflowState: 'APPROVED',
      approvalMode: 'AUTO',
    });
    expect(revisionWrite.contentSnapshot).toEqual({ version: 1, blocks: [] });
    expect(revisionWrite.frozenAt).toBeInstanceOf(Date);
  });

  /** Re-freezing would move `frozen_at` on a snapshot meant to be immutable. */
  it('does not re-freeze an already approved revision on republish', async () => {
    const { db, writes } = transactionalDb({
      revisions: [
        {
          id: 'rev-1',
          workflowState: 'APPROVED',
          contentDocument: { version: 1, blocks: [] },
        },
      ],
    });

    await publish(db);

    expect(writes.find((write) => write.table === productRevisions)).toBe(
      undefined,
    );
  });

  it('refuses a stale version rather than overwriting a concurrent edit', async () => {
    const { db } = transactionalDb({ product: productRow({ version: 5 }) });

    expect(await publish(db, 1)).toEqual({
      ok: false,
      reason: 'version_conflict',
    });
  });

  it('answers not_found identically for a missing and a foreign product', async () => {
    const { db } = transactionalDb({ product: undefined });

    // `rowsForTable` returns the default row unless told otherwise, so use an
    // explicitly empty result set here.
    const emptyDb = {
      ...db,
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          select: () => {
            const builder: Record<string, unknown> = {};

            ['from', 'leftJoin', 'where'].forEach((name) => {
              builder[name] = vi.fn(() => builder);
            });
            builder.limit = vi.fn(() => []);

            return builder;
          },
        }),
      ),
    };

    expect(await publish(emptyDb)).toEqual({ ok: false, reason: 'not_found' });
  });

  it.each([
    ['UNMAPPED', 'CATEGORY_UNMAPPED'],
    ['AMBIGUOUS', 'CATEGORY_UNMAPPED'],
  ])('refuses a %s category mapping', async (confidence, reason) => {
    const { db } = transactionalDb({ product: productRow({ confidence }) });

    expect(await publish(db)).toEqual({ ok: false, reason });
    expect(mocks.resolveProductPricing).not.toHaveBeenCalled();
  });

  it('refuses when the product has no active variant', async () => {
    const { db } = transactionalDb({ variants: [] });

    expect(await publish(db)).toEqual({
      ok: false,
      reason: 'NO_ACTIVE_VARIANT',
    });
  });

  /** A live offer with no fulfilment authority is an unfulfillable checkout. */
  it('refuses when no variant has an active supplier binding', async () => {
    const { db } = transactionalDb({
      variants: [variantRow({ bindingState: 'UNVERIFIED' })],
    });

    expect(await publish(db)).toEqual({
      ok: false,
      reason: 'NO_ACTIVE_SUPPLIER_BINDING',
    });
  });

  it('refuses when no supplier cost has been observed', async () => {
    const { db } = transactionalDb({
      variants: [variantRow({ costMinor: null })],
    });

    expect(await publish(db)).toEqual({
      ok: false,
      reason: 'NO_SUPPLIER_COST',
    });
  });

  it('refuses when no approved media exists', async () => {
    const { db } = transactionalDb({ approvedMedia: [] });

    expect(await publish(db)).toEqual({
      ok: false,
      reason: 'NO_APPROVED_MEDIA',
    });
  });

  /**
   * The resolver fails closed for a real missing input. Publishing anyway at a
   * fallback margin is the flat markup ADR-003 prohibits.
   */
  it('surfaces the resolver’s own reason instead of inventing a price', async () => {
    const { db, writes } = transactionalDb();

    mocks.resolveProductPricing.mockResolvedValue({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'CATEGORY_POLICY_REQUIRED',
      reasonLabel: 'Category policy required',
      resolverVersion: 'pricing-resolver-v2',
    });

    expect(await publish(db)).toEqual({
      ok: false,
      reason: 'PRICING_UNRESOLVED',
      detail: 'CATEGORY_POLICY_REQUIRED',
    });
    expect(writes.find((write) => write.table === products)).toBe(undefined);
  });

  it('refuses when the seller has no active market profile', async () => {
    mocks.findActiveProfileForSeller.mockResolvedValue(null);

    const { db } = transactionalDb();

    expect(await publish(db)).toEqual({
      ok: false,
      reason: 'NO_ACTIVE_MARKET_PROFILE',
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('refuses a currency the destination has not authorized', async () => {
    mocks.isAuthorizedSellingCurrency.mockReturnValue(false);

    const { db } = transactionalDb();

    expect(await publish(db)).toEqual({
      ok: false,
      reason: 'CURRENCY_NOT_AUTHORIZED',
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    [null, 'UNKNOWN'],
    [0, 'UNAVAILABLE'],
    [36, 'AVAILABLE'],
  ])(
    'maps observed inventory %s to availability %s',
    async (inventory, expected) => {
      const { db } = transactionalDb({
        variants: [variantRow({ inventory })],
      });

      const result = await publish(db);

      expect(result).toMatchObject({ ok: true, availability: expected });
    },
  );

  /** "We saw stock three weeks ago" is not a stock claim. */
  it('degrades stale inventory evidence to UNKNOWN', async () => {
    const { db } = transactionalDb({
      variants: [
        variantRow({
          inventory: 36,
          observedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        }),
      ],
    });

    expect(await publish(db)).toMatchObject({ availability: 'UNKNOWN' });
  });

  it('audits the publication with the rights basis it used', async () => {
    const { db } = transactionalDb();

    await publish(db);

    const productAudit = mocks.appendAuditEvent.mock.calls.find(
      (call) => call[1].action === 'catalog_product.published',
    );

    expect(productAudit?.[1].payload).toMatchObject({
      slug: 'waterproof-shell-jacket',
      marketCode: 'AU',
      rightsBasis: 'SUPPLIER_TERMS',
    });
  });

  it('keeps an existing slug rather than regenerating one on republish', async () => {
    const { db, writes } = transactionalDb({
      product: productRow({ slug: 'already-live-jacket', version: 3 }),
    });

    await publish(db, 3);

    const productWrite = writes.find((write) => write.table === products)
      ?.values as Record<string, unknown>;

    expect(productWrite.slug).toBe('already-live-jacket');
  });

  it('reads the category through the taxonomy table, not a supplier field', async () => {
    const { db } = transactionalDb();

    await publish(db);

    // The pricing resolver must be handed the Sals3 taxonomy code, never CJ's
    // own category name.
    expect(mocks.resolveProductPricing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        categoryCode: 'CAT-APP-100412',
        settlementCurrency: 'USD',
      }),
    );
    expect(sals3Categories).toBeDefined();
  });
});
