// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listProfilesForSeller: vi.fn(),
  findAuthorizedDestination: vi.fn(),
  resolveSellerMarketCapabilities: vi.fn(),
}));

vi.mock('./repository', () => ({
  listProfilesForSeller: mocks.listProfilesForSeller,
}));
vi.mock('./capabilities', () => ({
  findAuthorizedDestination: mocks.findAuthorizedDestination,
  resolveSellerMarketCapabilities: mocks.resolveSellerMarketCapabilities,
}));

/* eslint-disable import/first */
import resolveOfferDestinations from './offer-destinations';
/* eslint-enable import/first */

const EXECUTOR = {} as never;

function profile(code: string, status = 'ACTIVE', id = `profile-${code}`) {
  return { id, destinationCountryCode: code, status };
}

/** The platform's own authorized list, in order. `AU` is first. */
function platform(codes: string[]) {
  mocks.resolveSellerMarketCapabilities.mockReturnValue({
    capabilityVersion: 'v-test',
    destinations: codes.map((code) => ({ destinationCountryCode: code })),
  });
}

describe('resolveOfferDestinations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findAuthorizedDestination.mockImplementation((code: string) =>
      ['AU', 'PH'].includes(code) ? { destinationCountryCode: code } : null,
    );
    platform(['AU', 'PH']);
  });

  it("uses the seller's own ACTIVE profiles when they have any", async () => {
    mocks.listProfilesForSeller.mockResolvedValue([
      profile('PH'),
      profile('AU'),
    ]);

    await expect(resolveOfferDestinations(EXECUTOR, 's1')).resolves.toEqual([
      { marketCode: 'PH', profileId: 'profile-PH' },
      { marketCode: 'AU', profileId: 'profile-AU' },
    ]);
  });

  it('ignores a profile that is not ACTIVE', async () => {
    mocks.listProfilesForSeller.mockResolvedValue([profile('PH', 'DRAFT')]);

    await expect(resolveOfferDestinations(EXECUTOR, 's1')).resolves.toEqual([
      { marketCode: 'AU', profileId: null },
    ]);
  });

  /**
   * The defect this function was extracted for. The screen that creates a
   * profile was removed on 2026-08-20, so every seller is in this state, and
   * `create-draft.ts` was answering it with an empty list — which made the
   * draft's offer loop run zero times and left the product with no
   * `product_offers` rows at all.
   */
  it('falls back to the platform destination when the seller has chosen nothing', async () => {
    mocks.listProfilesForSeller.mockResolvedValue([]);

    await expect(resolveOfferDestinations(EXECUTOR, 's1')).resolves.toEqual([
      { marketCode: 'AU', profileId: null },
    ]);
  });

  /**
   * One destination, not the whole authorized list: `publish.ts` writes offers
   * for a single destination, so a draft creating one per authorized market
   * would be rows nothing ever reads and a create/publish pair that disagree.
   */
  it('falls back to exactly one destination, the same one publish picks', async () => {
    mocks.listProfilesForSeller.mockResolvedValue([]);
    platform(['AU', 'PH', 'NZ']);

    await expect(resolveOfferDestinations(EXECUTOR, 's1')).resolves.toEqual([
      { marketCode: 'AU', profileId: null },
    ]);
  });

  /**
   * A seller with an `ACTIVE` profile for a withdrawn destination **has chosen**
   * where they sell and the choice is gone. Substituting another market would
   * publish their product somewhere they never asked for — the old `publish.ts`
   * refused this case, and telling it apart from "chose nothing" is the reason
   * the fallback is not simply "no usable profile".
   */
  it('refuses rather than substituting when every chosen destination is withdrawn', async () => {
    mocks.listProfilesForSeller.mockResolvedValue([profile('NZ')]);

    await expect(resolveOfferDestinations(EXECUTOR, 's1')).resolves.toEqual([]);
  });

  it('keeps the authorized half when only some chosen destinations are withdrawn', async () => {
    mocks.listProfilesForSeller.mockResolvedValue([
      profile('NZ'),
      profile('AU'),
    ]);

    await expect(resolveOfferDestinations(EXECUTOR, 's1')).resolves.toEqual([
      { marketCode: 'AU', profileId: 'profile-AU' },
    ]);
  });

  /**
   * Fail-closed, matching `resolveSellerMarketCapabilities`'s own posture for a
   * disabled global policy: no platform destination means no offer, not a
   * hardcoded one.
   */
  it('returns nothing when the platform authorizes nothing', async () => {
    mocks.listProfilesForSeller.mockResolvedValue([]);
    platform([]);

    await expect(resolveOfferDestinations(EXECUTOR, 's1')).resolves.toEqual([]);
  });

  it('never consults the platform list when a chosen destination is usable', async () => {
    mocks.listProfilesForSeller.mockResolvedValue([profile('PH')]);

    await resolveOfferDestinations(EXECUTOR, 's1');

    expect(mocks.resolveSellerMarketCapabilities).not.toHaveBeenCalled();
  });
});
