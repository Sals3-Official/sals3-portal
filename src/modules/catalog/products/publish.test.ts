// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  categoryAttributeControls,
  productCategoryAttributeValues,
  productMediaSources,
  productOptions,
  productRevisions,
  products,
  productVariants,
  sals3Categories,
} from '@/lib/db/schema';

const mocks = vi.hoisted(() => ({
  listProfilesForSeller: vi.fn(),
  findAuthorizedDestination: vi.fn(),
  isAuthorizedSellingCurrency: vi.fn(),
  resolveSellerMarketCapabilities: vi.fn(),
  resolveProductPricing: vi.fn(),
  projectSupplierMedia: vi.fn(),
  appendAuditEvent: vi.fn(),
}));

// `publish.ts` reads destinations through the shared `resolveOfferDestinations`
// now (2026-08-28), which asks for the whole profile list and filters `ACTIVE`
// itself — so the seam moved from `findActiveProfileForSeller` to this.
vi.mock('@/modules/market-config/repository', () => ({
  listProfilesForSeller: mocks.listProfilesForSeller,
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
  // The shared resolver filters on this rather than trusting the reader to
  // have done it, so the fixture has to carry it.
  status: 'ACTIVE' as const,
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
  /** `product_options` rows. Non-empty means the seller already mapped axes. */
  options?: Record<string, unknown>[];
  /** `sals3_categories` row `findCategoryByCode` resolves to. `undefined` means "not found" (contract unavailable). */
  attributeCategoryRow?: Record<string, unknown>;
  /** `category_attribute_controls` rows for the resolved category. Empty means no controls exist yet. */
  attributeControls?: Record<string, unknown>[];
  /** `product_category_attribute_values` rows already stored for this product. */
  attributeValues?: Record<string, unknown>[];
};

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    title: 'Waterproof Shell Jacket',
    slug: null,
    version: 1,
    categoryId: 'cat-1',
    categoryCode: 'CAT-GGL-1604',
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
    if (table === productOptions) return overrides.options ?? [];
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

    // `findCategoryByCode` reads this table directly (not through the
    // `products` left-join above, which is already flattened onto the fixture
    // row). Absent by default so every existing test's category resolves to
    // `CATEGORY_NOT_FOUND` and the specification gate never engages.
    if (table === sals3Categories) {
      return overrides.attributeCategoryRow === undefined
        ? []
        : [overrides.attributeCategoryRow];
    }

    // `findAttributeControlsByCategoryCode` selects `{ control: ... }`, so the
    // fixture rows must be wrapped the same way.
    if (table === categoryAttributeControls) {
      return (overrides.attributeControls ?? []).map((control) => ({
        control,
      }));
    }

    if (table === productCategoryAttributeValues) {
      return overrides.attributeValues ?? [];
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

function publishWithRetailPrice(db: unknown, expectedProductVersion = 1) {
  return publishProduct({
    productId: PRODUCT_ID,
    sellerAccountId: SELLER_ID,
    actorId: 'actor-1',
    expectedProductVersion,
    variantRetailPrices: [
      { variantId: 'variant-1', amountMinor: 12000, currency: 'USD' },
    ],
    db: db as never,
  });
}

describe('publishProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listProfilesForSeller.mockResolvedValue([PROFILE]);
    mocks.findAuthorizedDestination.mockReturnValue(DESTINATION);
    mocks.isAuthorizedSellingCurrency.mockReturnValue(true);
    mocks.resolveSellerMarketCapabilities.mockReturnValue({
      capabilityVersion: 'seller-market-capability-v2-au-ph-usd-publishable',
      destinations: [DESTINATION],
    });
    mocks.resolveProductPricing.mockResolvedValue(PRICED);
    mocks.projectSupplierMedia.mockResolvedValue({
      inserted: 1,
      skipped: 0,
      source: 'DETAIL_EVIDENCE',
    });
    // No CJ category to mirror unless a test says otherwise.
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

    const revisionWrites = writes.filter(
      (write) => write.table === productRevisions,
    );

    // One write, and it is the supersede sweep — never a second freeze. The
    // sweep excludes the revision being published (`ne` in the statement) and
    // sets no snapshot or `frozenAt`, so an accepted order's frozen content
    // stays byte-identical.
    expect(revisionWrites).toHaveLength(1);
    expect(revisionWrites[0]?.values).toEqual(
      expect.objectContaining({ workflowState: 'SUPERSEDED' }),
    );
    expect(revisionWrites[0]?.values).not.toEqual(
      expect.objectContaining({ contentSnapshot: expect.anything() }),
    );
    expect(revisionWrites[0]?.values).not.toEqual(
      expect.objectContaining({ frozenAt: expect.anything() }),
    );
  });

  it('retires the previous approved revision when a draft is published', async () => {
    const { db, writes } = transactionalDb();

    await publish(db);

    const revisionWrites = writes.filter(
      (write) => write.table === productRevisions,
    );

    // The freeze of the draft, then the sweep that retires whatever it
    // replaces. `APPROVED` must name one revision per product: the one the
    // storefront is served from.
    expect(revisionWrites).toHaveLength(2);
    expect(revisionWrites[0]?.values).toEqual(
      expect.objectContaining({ workflowState: 'APPROVED' }),
    );
    expect(revisionWrites[1]?.values).toEqual(
      expect.objectContaining({ workflowState: 'SUPERSEDED' }),
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

  it.each([['UNMAPPED'], ['AMBIGUOUS']])(
    'refuses a %s category mapping outright — no mirror is minted to get past it',
    async (confidence) => {
      const { db } = transactionalDb({ product: productRow({ confidence }) });

      expect(await publish(db)).toEqual({
        ok: false,
        reason: 'SALS3_CATEGORY_REQUIRED',
      });
    },
  );

  /**
   * The 2026-08-20 reversal. Publication used to mint a `CJ-<uuid>` mirror
   * category and carry on; a mirror is a draft default, not a Sals3
   * category, and it must not reach a live listing.
   */
  it('refuses a CJ mirror category even when the mapping confidence is EXACT', async () => {
    const { db } = transactionalDb({
      product: productRow({
        categoryCode: 'CJ-2409230540351618000',
        confidence: 'EXACT',
      }),
    });

    expect(await publish(db)).toEqual({
      ok: false,
      reason: 'SALS3_CATEGORY_REQUIRED',
    });
    // And it refuses before pricing — a mirrored node must never resolve a margin.
    expect(mocks.resolveProductPricing).not.toHaveBeenCalled();
  });

  it('refuses a Taxonomy v0 code, which is not a v1 category either', async () => {
    const { db } = transactionalDb({
      product: productRow({
        categoryCode: 'CAT-APP-100412',
        confidence: 'EXACT',
      }),
    });

    expect(await publish(db)).toEqual({
      ok: false,
      reason: 'SALS3_CATEGORY_REQUIRED',
    });
  });

  /**
   * Four labels forming a complete two-axis grid — the shape
   * `deriveOptionSplit` accepts. Every other field comes from `variantRow` so the
   * earlier refusals still pass and the option gate is what answers.
   */
  function griddedVariants() {
    return ['Black-S', 'Black-M', 'Red-S', 'Red-M'].map((label, index) =>
      variantRow({ variantId: `variant-${index + 1}`, label }),
    );
  }

  it('refuses to publish a derivable grid whose option groups are unnamed', async () => {
    const { db } = transactionalDb({ variants: griddedVariants() });

    expect(await publish(db)).toEqual({
      ok: false,
      reason: 'OPTIONS_UNMAPPED',
    });
    // Refused before pricing, so an unmapped product never reaches the resolver.
    expect(mocks.resolveProductPricing).not.toHaveBeenCalled();
  });

  /**
   * The real Winter Khaki Jacket's shape: one colour, three sizes (trimmed
   * from five). `deriveOptionSplit` drops the constant `Khaki` position and
   * offers `Size` alone - this is the exact live-product case the
   * constant-position fix exists for, so the gate above it must reach it too.
   */
  function oneConstantPositionVariants() {
    return ['Khaki-M', 'Khaki-S', 'Khaki-L'].map((label, index) =>
      variantRow({ variantId: `variant-${index + 1}`, label }),
    );
  }

  it('refuses to publish a grid with a dropped constant position that is unnamed', async () => {
    const { db } = transactionalDb({ variants: oneConstantPositionVariants() });

    expect(await publish(db)).toEqual({
      ok: false,
      reason: 'OPTIONS_UNMAPPED',
    });
    expect(mocks.resolveProductPricing).not.toHaveBeenCalled();
  });

  /**
   * The UAT face mask: five colours, no delimiter. `deriveOptionSplit` now
   * proposes one axis for it, so the Variant Matrix is nameable - but owner
   * decision 2026-08-18 keeps publication ungated for this shape. Gating it
   * would have made every colour-only product in the catalogue unpublishable
   * until a seller named its axis, and an unmapped `Black` already reads fine to
   * a buyer, unlike an unmapped `Army Green-XL`.
   */
  function singleAxisVariants() {
    return ['Black', 'Blue', 'Green'].map((label, index) =>
      variantRow({ variantId: `variant-${index + 1}`, label }),
    );
  }

  it('publishes a single-axis product whose option group is unnamed', async () => {
    const { db } = transactionalDb({ variants: singleAxisVariants() });
    const result = await publish(db);

    expect(result).not.toEqual(
      expect.objectContaining({ reason: 'OPTIONS_UNMAPPED' }),
    );
    // Proof it got past the option gate rather than failing earlier for an
    // unrelated reason.
    expect(mocks.resolveProductPricing).toHaveBeenCalled();
  });

  it('publishes a grid with a dropped constant position once its surviving axis is named', async () => {
    const { db } = transactionalDb({
      variants: oneConstantPositionVariants(),
      options: [{ id: 'option-1' }],
    });

    expect(await publish(db)).toMatchObject({ ok: true });
  });

  it('publishes a derivable grid once its option groups are named', async () => {
    const { db } = transactionalDb({
      variants: griddedVariants(),
      options: [{ id: 'option-1' }],
    });

    expect(await publish(db)).toMatchObject({ ok: true });
  });

  /**
   * The reason the gate is conditional rather than blanket. A single-variant
   * product cannot be mapped at all — `deriveOptionSplit` refuses fewer than two
   * variants and `saveOptionMapping` answers `SPLIT_NOT_DERIVABLE` — so
   * requiring a mapping here would make it permanently unpublishable, including
   * products already live.
   */
  it('publishes a single-variant product with no option mapping', async () => {
    const { db } = transactionalDb({
      variants: [variantRow({ label: 'Black' })],
      options: [],
    });

    expect(await publish(db)).toMatchObject({ ok: true });
  });

  it('publishes when supplier labels do not form a complete grid', async () => {
    const { db } = transactionalDb({
      // Ragged: two tokens then one. Not an encoding, so nothing to name.
      variants: [
        variantRow({ variantId: 'variant-1', label: 'Black-S' }),
        variantRow({ variantId: 'variant-2', label: 'Red' }),
      ],
      options: [],
    });

    expect(await publish(db)).toMatchObject({ ok: true });
  });

  it('does not categorise an UNMAPPED product from its CJ category any more', async () => {
    const { db, writes } = transactionalDb({
      product: productRow({
        categoryId: null,
        categoryCode: null,
        confidence: 'UNMAPPED',
      }),
    });

    const result = await publish(db);

    expect(result).toEqual({
      ok: false,
      reason: 'SALS3_CATEGORY_REQUIRED',
    });
    // Nothing was written on the way to the refusal — no mirror row, no
    // version bump, no publication flip.
    expect(writes).toHaveLength(0);
  });

  it('refuses when the product has no active variant', async () => {
    const { db } = transactionalDb({ variants: [] });

    expect(await publish(db)).toEqual({
      ok: false,
      reason: 'NO_ACTIVE_VARIANT',
    });
  });

  /** A live supplier offer with no provider variant reference is unfulfillable. */
  it('refuses when no variant has a provider variant reference', async () => {
    const { db } = transactionalDb({
      variants: [variantRow({ supplierVariantId: null, bindingState: null })],
    });

    expect(await publish(db)).toEqual({
      ok: false,
      reason: 'NO_ACTIVE_SUPPLIER_BINDING',
    });
  });

  it('publishes from stored provider variant evidence when no binding row exists yet', async () => {
    const { db } = transactionalDb({
      variants: [variantRow({ bindingState: null })],
    });

    expect(await publish(db)).toMatchObject({
      ok: true,
      slug: 'waterproof-shell-jacket',
    });
  });

  it('publishes with seller retail price instead of requiring category pricing policy', async () => {
    const { db, writes } = transactionalDb();

    mocks.resolveProductPricing.mockResolvedValue({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'CATEGORY_POLICY_REQUIRED',
      reasonLabel: 'Category policy required',
      resolverVersion: 'pricing-resolver-v2',
    });

    expect(await publishWithRetailPrice(db)).toMatchObject({
      ok: true,
      slug: 'waterproof-shell-jacket',
    });

    const offerWrite = writes.find(
      (write) => write.table !== products && write.table !== productRevisions,
    )?.values as Record<string, unknown>;

    expect(offerWrite).toMatchObject({
      priceAmountMinor: BigInt(12000),
      priceCurrency: 'USD',
      pricingResolverVersion: 'SELLER_RETAIL_PRICE_V1',
    });
    expect(mocks.resolveProductPricing).not.toHaveBeenCalled();
  });

  /**
   * The seller-price path skips the resolver, so it is the only place a floor can
   * be enforced. Before these tests it had none, and the live corduroy jacket
   * carried a US$4.51 offer against a US$5.80 supplier cost.
   */
  describe('the supplier-cost floor on a seller-entered price', () => {
    function publishAt(db: unknown, amountMinor: number, currency = 'USD') {
      return publishProduct({
        productId: PRODUCT_ID,
        sellerAccountId: SELLER_ID,
        actorId: 'actor-1',
        expectedProductVersion: 1,
        variantRetailPrices: [
          { variantId: 'variant-1', amountMinor, currency },
        ],
        db: db as never,
      });
    }

    it('refuses a price below the supplier cost, naming both figures', async () => {
      const { db, writes } = transactionalDb();

      const result = await publishAt(db, 500); // USD 5.00 against a cost of 7.96

      expect(result).toMatchObject({
        ok: false,
        reason: 'RETAIL_BELOW_SUPPLIER_COST',
      });
      expect((result as { detail?: string }).detail).toMatch(
        /USD 5\.00.*USD 7\.96/,
      );
      // Refused before anything was written: a partial publish is the one state
      // nothing else in the system can interpret.
      expect(writes).toHaveLength(0);
    });

    it('refuses a price exactly at the supplier cost', async () => {
      const { db, writes } = transactionalDb();

      expect(await publishAt(db, 796)).toMatchObject({
        ok: false,
        reason: 'RETAIL_BELOW_SUPPLIER_COST',
        detail: expect.stringMatching(
          /must be at least USD 8\.16.*2\.5% above.*USD 7\.96/,
        ),
      });
      expect(writes).toHaveLength(0);
    });

    it('refuses a price above cost but below the 2.5% floor', async () => {
      const { db, writes } = transactionalDb();

      expect(await publishAt(db, 815)).toMatchObject({
        ok: false,
        reason: 'RETAIL_BELOW_SUPPLIER_COST',
      });
      expect(writes).toHaveLength(0);
    });

    it('allows a price at the 2.5% supplier-cost floor', async () => {
      const { db } = transactionalDb();

      expect(await publishAt(db, 816)).toMatchObject({ ok: true });
    });

    it('refuses when the price cannot be compared to the cost at all', async () => {
      const { db } = transactionalDb();

      // No approved conversion exists on this path, so "is it above cost" has no
      // answer. Converting at an invented rate is the flat markup ADR-003 bans.
      const result = await publishAt(db, 99999, 'AUD');

      expect(result).toMatchObject({
        ok: false,
        reason: 'RETAIL_BELOW_SUPPLIER_COST',
      });
      expect((result as { detail?: string }).detail).toMatch(/AUD.*USD/);
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

  it('uses the first approved pilot destination when the seller has no active market profile', async () => {
    mocks.listProfilesForSeller.mockResolvedValue([]);

    const { db, writes } = transactionalDb();

    expect(await publish(db)).toMatchObject({
      ok: true,
      slug: 'waterproof-shell-jacket',
    });

    const offerWrite = writes.find(
      (write) => write.table !== products && write.table !== productRevisions,
    )?.values as Record<string, unknown>;

    expect(offerWrite).toMatchObject({
      marketCode: 'AU',
      marketProfileId: null,
    });
  });

  it('refuses when no active profile or approved pilot destination exists', async () => {
    mocks.listProfilesForSeller.mockResolvedValue([]);
    mocks.resolveSellerMarketCapabilities.mockReturnValue({
      capabilityVersion: 'seller-market-capability-v2-au-ph-usd-publishable',
      destinations: [],
    });

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
        categoryCode: 'CAT-GGL-1604',
        settlementCurrency: 'USD',
      }),
    );
    expect(sals3Categories).toBeDefined();
  });
});

describe('publishProduct — category attribute specifications never gate publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listProfilesForSeller.mockResolvedValue([PROFILE]);
    mocks.findAuthorizedDestination.mockReturnValue(DESTINATION);
    mocks.isAuthorizedSellingCurrency.mockReturnValue(true);
    mocks.resolveSellerMarketCapabilities.mockReturnValue({
      capabilityVersion: 'seller-market-capability-v2-au-ph-usd-publishable',
      destinations: [DESTINATION],
    });
    mocks.resolveProductPricing.mockResolvedValue(PRICED);
    mocks.projectSupplierMedia.mockResolvedValue({
      inserted: 1,
      skipped: 0,
      source: 'DETAIL_EVIDENCE',
    });
  });

  const CATEGORY_ROW = {
    id: 'cat-1',
    code: 'CAT-GGL-1604',
    path: 'Apparel & Accessories',
  };

  const REQUIRED_CONTROL = {
    attributeName: 'Fabric Material',
    requirementLevel: 'REQUIRED',
    inputControlType: 'TEXT_INPUT',
    allowedValues: [],
    allowCustomValue: true,
    allowMultipleValues: false,
    sellerHelpText: null,
    seoVisibility: 'PDP_VISIBLE',
    aeoGeoVisibility: 'ATTRIBUTE_CONTEXT_ONLY',
    sourceWorkbook: 'universal_category_variation_taxonomy_final_clean.xlsx',
    sourceSheet: 'Category_Attribute_Controls',
    sourceChecksum: 'checksum-abc',
  };

  it('has no effect when the category has no attribute controls for the active version', async () => {
    const { db } = transactionalDb({ attributeCategoryRow: CATEGORY_ROW });

    // No `attributeControls` override — the category resolves, but has no
    // controls, so `resolveCategoryAttributeContract` reports
    // `ATTRIBUTE_CONTROLS_UNAVAILABLE`, which must never block a publish.
    expect(await publish(db)).toMatchObject({ ok: true });
  });

  it('publishes even while a REQUIRED specification has no valid stored value', async () => {
    const { db } = transactionalDb({
      attributeCategoryRow: CATEGORY_ROW,
      attributeControls: [REQUIRED_CONTROL],
      attributeValues: [],
    });

    expect(await publish(db)).toMatchObject({ ok: true });
  });

  it('publishes even when the stored value is blank, not only when it is absent', async () => {
    const { db } = transactionalDb({
      attributeCategoryRow: CATEGORY_ROW,
      attributeControls: [REQUIRED_CONTROL],
      attributeValues: [{ attributeName: 'Fabric Material', values: ['   '] }],
    });

    expect(await publish(db)).toMatchObject({ ok: true });
  });

  it('publishes once the REQUIRED specification has a valid stored value', async () => {
    const { db } = transactionalDb({
      attributeCategoryRow: CATEGORY_ROW,
      attributeControls: [REQUIRED_CONTROL],
      attributeValues: [
        { attributeName: 'Fabric Material', values: ['Cotton'] },
      ],
    });

    expect(await publish(db)).toMatchObject({ ok: true });
  });
});
