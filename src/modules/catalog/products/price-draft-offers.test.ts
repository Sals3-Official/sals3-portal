// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const { resolveProductPricingMock } = vi.hoisted(() => ({
  resolveProductPricingMock: vi.fn(),
}));

vi.mock('@/modules/pricing/resolver', () => ({
  resolveProductPricing: resolveProductPricingMock,
}));

/* eslint-disable import/first */
import priceDraftOffers from './price-draft-offers';

/**
 * Reported by the owner on 2026-08-30: products acquired through sourcing
 * showed **Not available** in the Product Catalogue and could not be published.
 *
 * `create-draft.ts` prices with `UNMAPPED` and a null category — hardcoded to
 * decline, which was right when written. Nothing priced them afterwards:
 * `resolveProductPricing` had four callers and the one that maps a category was
 * not among them. The Product Editor showed a price the whole time, from
 * `pricing-guidance.ts`, which is computed live for display and is not the offer
 * row the catalogue and the publish gate read.
 */

const dialect = new PgDialect();
const SELLER_ID = '11111111-1111-4111-a111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-a222-222222222222';

function offerRow(overrides: Record<string, unknown> = {}) {
  return {
    offerId: 'offer-1',
    marketCode: 'AU',
    variantId: 'variant-1',
    categoryCode: 'CAT-GGL-166',
    categoryConfidence: 'EXACT',
    supplierCandidateId: 'candidate-1',
    supplierVariantId: 'cj-variant-1',
    costMinor: 486,
    costCurrency: 'USD',
    observedAt: new Date('2026-08-28T00:00:00.000Z'),
    ...overrides,
  };
}

function priced(amountMinor: number) {
  return {
    outcome: 'PRODUCT_MARGIN_ESTIMATE',
    resolverVersion: 'pricing-resolver-v3',
    roundedSuggestedItemPrice: { amountMinor, currency: 'USD' },
  };
}

/** Records the `SET` of every update, and the `WHERE` of the read. */
function fakeDb(rows: unknown[]) {
  const updates: Array<Record<string, unknown>> = [];
  const wheres: string[] = [];

  const selectBuilder: Record<string, unknown> = {};
  const self = (): unknown => selectBuilder;

  ['from', 'innerJoin', 'leftJoin'].forEach((name) => {
    selectBuilder[name] = vi.fn(self);
  });
  selectBuilder.where = vi.fn((condition: SQL | undefined) => {
    wheres.push(
      condition === undefined ? '' : dialect.sqlToQuery(condition).sql,
    );

    return selectBuilder;
  });
  selectBuilder.then = (resolve: (value: unknown) => unknown) => resolve(rows);

  const executor = {
    select: vi.fn(() => selectBuilder),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push(values);

        return { where: vi.fn(async () => []) };
      }),
    })),
  };

  return { executor, updates, wheres };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('priceDraftOffers', () => {
  it('writes the rules’ price onto an offer that had none', async () => {
    resolveProductPricingMock.mockResolvedValue(priced(1479));
    const { executor, updates } = fakeDb([offerRow()]);

    const result = await priceDraftOffers(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
      actorId: 'user-1',
    });

    expect(result).toEqual({ resolved: 1, unresolved: 0 });
    expect(updates[0]).toMatchObject({
      priceAmountMinor: BigInt(1479),
      priceCurrency: 'USD',
      pricingState: 'RESOLVED',
      pricingUnavailableReason: null,
    });
  });

  it('prices each offer for the destination its own row carries', async () => {
    /*
      Re-deriving a destination here could disagree with the row being written —
      the class of bug that put Australia's rules on Global's row in the
      store-default save.
    */
    resolveProductPricingMock.mockResolvedValue(priced(1479));
    const { executor } = fakeDb([
      offerRow({ offerId: 'offer-au', marketCode: 'AU' }),
      offerRow({ offerId: 'offer-fj', marketCode: 'FJ' }),
    ]);

    await priceDraftOffers(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
      actorId: 'user-1',
    });

    expect(resolveProductPricingMock.mock.calls[0][1].marketCode).toBe('AU');
    expect(resolveProductPricingMock.mock.calls[1][1].marketCode).toBe('FJ');
  });

  it('passes the observed supplier cost, not the null create-draft sends', async () => {
    // The other half of why a sourced product could never price itself: even
    // with a category, `create-draft` hands the resolver no cost at all.
    resolveProductPricingMock.mockResolvedValue(priced(1479));
    const { executor } = fakeDb([offerRow()]);

    await priceDraftOffers(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
      actorId: 'user-1',
    });

    expect(resolveProductPricingMock.mock.calls[0][1].supplierCost).toEqual({
      amountMinor: 486,
      currency: 'USD',
    });
    expect(resolveProductPricingMock.mock.calls[0][1].categoryCode).toBe(
      'CAT-GGL-166',
    );
  });

  it('records the resolver’s own reason when it still refuses', async () => {
    // A product whose category has no markup genuinely cannot be priced.
    // Silence would put it back in the state this exists to end.
    resolveProductPricingMock.mockResolvedValue({
      outcome: 'PRICING_UNAVAILABLE',
      reason: 'PRICING_POLICY_REQUIRED',
    });
    const { executor, updates } = fakeDb([offerRow()]);

    const result = await priceDraftOffers(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
      actorId: 'user-1',
    });

    expect(result).toEqual({ resolved: 0, unresolved: 1 });
    expect(updates[0]).toMatchObject({
      pricingState: 'UNRESOLVED',
      pricingUnavailableReason: 'PRICING_POLICY_REQUIRED',
    });
    // And it does not leave a price behind from a previous pass.
    expect(updates[0]).not.toHaveProperty('priceAmountMinor');
  });

  it('never touches a published offer', async () => {
    /*
      A published offer's price is what a buyer is being charged; moving it is
      `planReprice`'s job, behind a preview somebody approved. This runs on a
      category edit, where nobody is looking at a price list.
    */
    const { executor, wheres } = fakeDb([]);

    await priceDraftOffers(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
      actorId: 'user-1',
    });

    expect(wheres[0]).toContain('"publish_state" = ');
  });

  it('reads only this seller’s product', async () => {
    // A product id is guessable, and a read that fetched first and checked
    // ownership second would already have read another tenant's supplier cost.
    const { executor, wheres } = fakeDb([]);

    await priceDraftOffers(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
      actorId: 'user-1',
    });

    expect(wheres[0]).toContain('"steward_seller_account_id" = ');
    expect(wheres[0]).toContain('"seller_account_id" = ');
  });

  it('does nothing at all when the product has no draft offers', async () => {
    const { executor, updates } = fakeDb([]);

    const result = await priceDraftOffers(executor as never, {
      sellerAccountId: SELLER_ID,
      productId: PRODUCT_ID,
      actorId: 'user-1',
    });

    expect(result).toEqual({ resolved: 0, unresolved: 0 });
    expect(updates).toEqual([]);
    expect(resolveProductPricingMock).not.toHaveBeenCalled();
  });
});
