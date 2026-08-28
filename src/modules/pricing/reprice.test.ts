// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const { resolveProductPricingMock } = vi.hoisted(() => ({
  resolveProductPricingMock: vi.fn(),
}));

vi.mock('./resolver', () => ({
  resolveProductPricing: resolveProductPricingMock,
}));

/* eslint-disable import/first */
import {
  MAX_REPRICE_OFFERS,
  planReprice,
  writeReprice,
  type RepriceLine,
} from './reprice';

const dialect = new PgDialect();
const SELLER_ID = '11111111-1111-4111-a111-111111111111';

type Recorded = { rendered: string };

/** A chainable stand-in for the query builder, recording the `WHERE` it was given. */
function recordingExecutor(rows: unknown[]) {
  const recorded: Recorded[] = [];

  const builder: Record<string, unknown> = {};
  const self = (): unknown => builder;

  ['from', 'innerJoin', 'leftJoin', 'orderBy', 'limit'].forEach((name) => {
    builder[name] = vi.fn(self);
  });
  builder.where = vi.fn((condition: SQL | undefined) => {
    recorded.push({
      rendered:
        condition === undefined ? '' : dialect.sqlToQuery(condition).sql,
    });

    return builder;
  });
  builder.then = (resolve: (value: unknown) => unknown) => resolve(rows);

  return { executor: { select: vi.fn(() => builder) }, recorded };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    offerId: 'offer-1',
    offerVersion: 3,
    marketCode: 'AU',
    currentPriceMinor: BigInt(2399),
    currentPriceCurrency: 'USD',
    pricingDecision: { resolvedLayer: 'CATEGORY' },
    pricingResolverVersion: 'pricing-resolver-v3',
    variantId: 'variant-1',
    sku: 'SALS3-1',
    productId: 'product-1',
    productTitle: 'Corduroy jacket',
    categoryCode: 'CAT-GGL-1',
    categoryConfidence: 'EXACT',
    supplierCandidateId: 'candidate-1',
    supplierVariantId: 'cj-variant-1',
    costMinor: 580,
    costCurrency: 'USD',
    observedAt: new Date('2026-08-28T00:00:00.000Z'),
    ...overrides,
  };
}

function resolved(amountMinor: number) {
  return {
    outcome: 'PRODUCT_MARGIN_ESTIMATE',
    resolvedLayer: 'CATEGORY',
    resolverVersion: 'pricing-resolver-v3',
    roundedSuggestedItemPrice: { amountMinor, currency: 'USD' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('planReprice', () => {
  it('reads only this seller’s published offers', async () => {
    const { executor, recorded } = recordingExecutor([]);

    await planReprice(executor as never, SELLER_ID);

    expect(recorded).toHaveLength(1);
    expect(recorded[0].rendered).toContain('"seller_account_id" = ');
    expect(recorded[0].rendered).toContain('"publish_state" = ');
  });

  it('marks an offer whose rules now say a different number', async () => {
    const { executor } = recordingExecutor([candidate()]);
    resolveProductPricingMock.mockResolvedValue(resolved(2999));

    const plan = await planReprice(executor as never, SELLER_ID);

    expect(plan.counts).toMatchObject({ changed: 1, unchanged: 0 });
    expect(plan.lines[0]).toMatchObject({
      status: 'CHANGED',
      currentPriceMinor: 2399,
      newPriceMinor: 2999,
      newPriceCurrency: 'USD',
    });
  });

  it('leaves an offer alone when the rules still say what it already carries', async () => {
    const { executor } = recordingExecutor([candidate()]);
    resolveProductPricingMock.mockResolvedValue(resolved(2399));

    const plan = await planReprice(executor as never, SELLER_ID);

    expect(plan.counts).toMatchObject({ changed: 0, unchanged: 1 });
    expect(plan.lines[0].newPriceMinor).toBeNull();
  });

  /**
   * The case that would otherwise destroy a deliberate decision.
   *
   * `publishProduct` lets a seller type a retail price, which skips the
   * resolver and stamps `SELLER_RETAIL_PRICE`. Repricing that offer would
   * replace a number a person chose with one a rule computed, silently, in a
   * bulk action — so the resolver is never even asked about it.
   */
  it.each([
    {
      label: 'publish-time shape',
      row: {
        pricingDecision: { resolvedLayer: 'SELLER_RETAIL_PRICE' },
        pricingResolverVersion: 'SELLER_RETAIL_PRICE_V1',
      },
    },
    {
      /**
       * The shape `updateSellerRetailPrices` writes on a draft save — no
       * `resolvedLayer` at all. A check that recognised only the publish-time
       * shape would have repriced every price entered this way, which is most
       * of them.
       */
      label: 'draft-save shape',
      row: {
        pricingDecision: { source: 'SELLER_RETAIL_PRICE', amountMinor: 330 },
        pricingResolverVersion: 'SELLER_RETAIL_PRICE_V1',
      },
    },
    {
      label: 'resolver version alone',
      row: {
        pricingDecision: null,
        pricingResolverVersion: 'SELLER_RETAIL_PRICE_V1',
      },
    },
  ])('never reprices a price a person typed ($label)', async ({ row }) => {
    const { executor } = recordingExecutor([candidate(row)]);

    const plan = await planReprice(executor as never, SELLER_ID);

    expect(plan.counts).toMatchObject({ manual: 1, changed: 0 });
    expect(resolveProductPricingMock).not.toHaveBeenCalled();
  });

  it('keeps the live price and names the reason when the resolver refuses', async () => {
    const { executor } = recordingExecutor([candidate()]);
    resolveProductPricingMock.mockResolvedValue({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'SUPPLIER_COST_UNAVAILABLE',
      reasonLabel: 'Supplier cost unavailable',
      resolverVersion: 'pricing-resolver-v3',
    });

    const plan = await planReprice(executor as never, SELLER_ID);

    expect(plan.counts).toMatchObject({ unpriceable: 1, changed: 0 });
    expect(plan.lines[0]).toMatchObject({
      status: 'UNPRICEABLE',
      reasonLabel: 'Supplier cost unavailable',
      newPriceMinor: null,
    });
  });

  /**
   * An offer written for Fiji must be repriced by Fiji's rule. Passing the
   * screen's destination instead would move it onto another country's margin
   * without anything on screen saying so.
   */
  it('prices each offer against its own destination', async () => {
    const { executor } = recordingExecutor([
      candidate({ offerId: 'offer-fj', marketCode: 'FJ' }),
    ]);
    resolveProductPricingMock.mockResolvedValue(resolved(2999));

    await planReprice(executor as never, SELLER_ID);

    expect(resolveProductPricingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ marketCode: 'FJ', categoryCode: 'CAT-GGL-1' }),
    );
  });

  it('passes a missing supplier cost through as null rather than inventing one', async () => {
    const { executor } = recordingExecutor([
      candidate({ costMinor: null, costCurrency: null }),
    ]);
    resolveProductPricingMock.mockResolvedValue({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'SUPPLIER_COST_UNAVAILABLE',
      reasonLabel: 'Supplier cost unavailable',
      resolverVersion: 'pricing-resolver-v3',
    });

    await planReprice(executor as never, SELLER_ID);

    expect(resolveProductPricingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ supplierCost: null }),
    );
  });

  it('says so out loud when there are more offers than one run covers', async () => {
    const rows = Array.from({ length: MAX_REPRICE_OFFERS + 1 }, (_, index) =>
      candidate({ offerId: `offer-${index}` }),
    );
    const { executor } = recordingExecutor(rows);
    resolveProductPricingMock.mockResolvedValue(resolved(2399));

    const plan = await planReprice(executor as never, SELLER_ID);

    expect(plan.truncated).toBe(true);
    expect(plan.lines).toHaveLength(MAX_REPRICE_OFFERS);
  });

  describe('the fingerprint', () => {
    it('is stable for the same set of writes', async () => {
      resolveProductPricingMock.mockResolvedValue(resolved(2999));

      const first = await planReprice(
        recordingExecutor([candidate()]).executor as never,
        SELLER_ID,
      );
      const second = await planReprice(
        recordingExecutor([candidate()]).executor as never,
        SELLER_ID,
      );

      expect(first.fingerprint).toBe(second.fingerprint);
    });

    it('moves when a price would be written differently', async () => {
      resolveProductPricingMock.mockResolvedValue(resolved(2999));
      const first = await planReprice(
        recordingExecutor([candidate()]).executor as never,
        SELLER_ID,
      );

      resolveProductPricingMock.mockResolvedValue(resolved(3199));
      const second = await planReprice(
        recordingExecutor([candidate()]).executor as never,
        SELLER_ID,
      );

      expect(first.fingerprint).not.toBe(second.fingerprint);
    });
  });
});

describe('writeReprice', () => {
  function updatingExecutor(returns: unknown[][]) {
    const wheres: string[] = [];
    let callIndex = -1;

    const builder: Record<string, unknown> = {};
    builder.set = vi.fn(() => builder);
    builder.where = vi.fn((condition: SQL | undefined) => {
      wheres.push(
        condition === undefined ? '' : dialect.sqlToQuery(condition).sql,
      );
      return builder;
    });
    builder.returning = vi.fn(() => {
      callIndex += 1;
      return Promise.resolve(returns[callIndex] ?? []);
    });

    return { tx: { update: vi.fn(() => builder) }, wheres, builder };
  }

  function changedLine(overrides: Partial<RepriceLine> = {}): RepriceLine {
    return {
      offerId: 'offer-1',
      offerVersion: 3,
      productId: 'product-1',
      productTitle: 'Corduroy jacket',
      sku: 'SALS3-1',
      marketCode: 'AU',
      currentPriceMinor: 2399,
      currentPriceCurrency: 'USD',
      newPriceMinor: 2999,
      newPriceCurrency: 'USD',
      status: 'CHANGED',
      reason: null,
      reasonLabel: null,
      decision: resolved(2999) as never,
      ...overrides,
    };
  }

  it('writes only the changed lines', async () => {
    const { tx, builder } = updatingExecutor([[{ id: 'offer-1' }]]);

    const result = await writeReprice(
      tx as never,
      [
        changedLine(),
        changedLine({ offerId: 'offer-2', status: 'UNCHANGED' }),
        changedLine({ offerId: 'offer-3', status: 'UNPRICEABLE' }),
        changedLine({ offerId: 'offer-4', status: 'MANUAL' }),
      ],
      { actorId: 'user-1', sellerAccountId: SELLER_ID },
    );

    expect(result).toEqual({ ok: true, written: 1 });
    expect(builder.set).toHaveBeenCalledTimes(1);
  });

  /** Tenant scope and compare-and-set in the same predicate, as everywhere else in this codebase. */
  it('scopes every write to the seller and the version it planned from', async () => {
    const { tx, wheres } = updatingExecutor([[{ id: 'offer-1' }]]);

    await writeReprice(tx as never, [changedLine()], {
      actorId: 'user-1',
      sellerAccountId: SELLER_ID,
    });

    expect(wheres[0]).toContain('"seller_account_id" = ');
    expect(wheres[0]).toContain('"version" = ');
  });

  /**
   * A republish landing mid-run must abort the whole thing. A half-applied
   * reprice leaves the catalogue priced by two different decisions with
   * nothing on screen saying which rows took.
   */
  it('stops at the first offer that moved underneath it', async () => {
    const { tx, builder } = updatingExecutor([[{ id: 'offer-1' }], []]);

    const result = await writeReprice(
      tx as never,
      [
        changedLine(),
        changedLine({ offerId: 'offer-2' }),
        changedLine({ offerId: 'offer-3' }),
      ],
      { actorId: 'user-1', sellerAccountId: SELLER_ID },
    );

    expect(result).toEqual({ ok: false, reason: 'version_conflict' });
    // The third was never attempted.
    expect(builder.set).toHaveBeenCalledTimes(2);
  });
});
