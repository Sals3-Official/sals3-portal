// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveOfferDestinations: vi.fn(),
  resolveSellerMarketCapabilities: vi.fn(),
  insertUnpublishedOffer: vi.fn(),
}));

vi.mock('@/modules/market-config/offer-destinations', () => ({
  default: mocks.resolveOfferDestinations,
}));
vi.mock('@/modules/market-config/capabilities', () => ({
  resolveSellerMarketCapabilities: mocks.resolveSellerMarketCapabilities,
}));
vi.mock('./repository', () => ({
  insertUnpublishedOffer: mocks.insertUnpublishedOffer,
}));

/* eslint-disable import/first */
import backfillDraftOffers from './backfill-draft-offers';
/* eslint-enable import/first */

type Row = { variantId: string; productId: string; sellerAccountId: string };

/**
 * Two selects run: the scan, then the after-the-writes recount. Handing back a
 * queue lets a test say "these were pending, and this many were left".
 */
function fakeDb(scans: Row[][]) {
  const queue = [...scans];
  const limits: number[] = [];

  const chain = (rows: Row[]) => ({
    from: () => ({
      innerJoin: () => ({
        where: () => {
          const builder = {
            limit: (n: number) => {
              limits.push(n);

              return Promise.resolve(rows);
            },
            then: (resolve: (value: unknown) => unknown) => resolve(rows),
          };

          return builder;
        },
      }),
    }),
  });

  return {
    db: { select: () => chain(queue.shift() ?? []) } as never,
    limits,
  };
}

const AU = { marketCode: 'AU', profileId: null };

describe('backfillDraftOffers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSellerMarketCapabilities.mockReturnValue({
      capabilityVersion: 'v-test',
      destinations: [{ destinationCountryCode: 'AU' }],
    });
    mocks.resolveOfferDestinations.mockResolvedValue([AU]);
    mocks.insertUnpublishedOffer.mockResolvedValue({ id: 'offer-1' });
  });

  it('creates one offer per offerless draft variant', async () => {
    const { db } = fakeDb([
      [
        { variantId: 'v1', productId: 'p1', sellerAccountId: 's1' },
        { variantId: 'v2', productId: 'p1', sellerAccountId: 's1' },
      ],
      [],
    ]);

    await expect(backfillDraftOffers({ db })).resolves.toMatchObject({
      offersCreated: 2,
      productsRepaired: 1,
      remaining: 0,
    });
  });

  /**
   * The row must be the same shape `create-draft.ts` writes, or the
   * `product_offers_pricing_state_explained` CHECK refuses it — and a priceless
   * row that claimed `RESOLVED` would be worse than the missing row it replaces.
   */
  it('writes an unresolved, priceless offer and says why', async () => {
    const { db } = fakeDb([
      [{ variantId: 'v1', productId: 'p1', sellerAccountId: 's1' }],
      [],
    ]);

    await backfillDraftOffers({ db });

    expect(mocks.insertUnpublishedOffer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        variantId: 'v1',
        marketCode: 'AU',
        marketProfileId: null,
        pricingUnavailableReason: 'PRICING_NOT_ATTEMPTED',
        marketCapabilityVersion: 'v-test',
      }),
    );
  });

  /**
   * The whole defect was two answers to "where may this seller offer". A
   * backfill that resolved destinations itself would be a third.
   */
  it('asks the shared resolver once per seller, not once per variant', async () => {
    const { db } = fakeDb([
      [
        { variantId: 'v1', productId: 'p1', sellerAccountId: 's1' },
        { variantId: 'v2', productId: 'p2', sellerAccountId: 's1' },
        { variantId: 'v3', productId: 'p3', sellerAccountId: 's2' },
      ],
      [],
    ]);

    await backfillDraftOffers({ db });

    expect(mocks.resolveOfferDestinations).toHaveBeenCalledTimes(2);
  });

  /**
   * A seller whose every chosen destination has been withdrawn is skipped for
   * the same reason `publish.ts` refuses them: substituting a market they never
   * asked for is worse than leaving the draft alone.
   */
  it('skips a seller with no authorized destination rather than substituting one', async () => {
    mocks.resolveOfferDestinations.mockResolvedValue([]);

    const { db } = fakeDb([
      [{ variantId: 'v1', productId: 'p1', sellerAccountId: 's1' }],
      [{ variantId: 'v1', productId: 'p1', sellerAccountId: 's1' }],
    ]);

    await expect(backfillDraftOffers({ db })).resolves.toMatchObject({
      offersCreated: 0,
      sellersWithNoAuthorizedDestination: 1,
      remaining: 1,
    });
    expect(mocks.insertUnpublishedOffer).not.toHaveBeenCalled();
  });

  /**
   * Counted after the writes, from the database rather than from the intent —
   * so a run that achieved nothing cannot report that it did.
   */
  it('reports what is left by re-reading, not by subtracting', async () => {
    const { db } = fakeDb([
      [{ variantId: 'v1', productId: 'p1', sellerAccountId: 's1' }],
      [{ variantId: 'v9', productId: 'p9', sellerAccountId: 's9' }],
    ]);

    await expect(backfillDraftOffers({ db })).resolves.toMatchObject({
      offersCreated: 1,
      remaining: 1,
    });
  });

  it('bounds one run so a repeat finishes the rest', async () => {
    const { db, limits } = fakeDb([[], []]);

    await backfillDraftOffers({ db });

    expect(limits).toEqual([500]);
  });

  it('is a no-op when nothing is broken', async () => {
    const { db } = fakeDb([[], []]);

    await expect(backfillDraftOffers({ db })).resolves.toEqual({
      offersCreated: 0,
      productsRepaired: 0,
      sellersWithNoAuthorizedDestination: 0,
      remaining: 0,
    });
  });
});
