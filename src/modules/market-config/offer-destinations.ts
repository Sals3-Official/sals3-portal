import type { Executor } from '@/modules/catalog/candidates/repository';
import {
  findAuthorizedDestination,
  resolveSellerMarketCapabilities,
} from './capabilities';
import { listProfilesForSeller } from './repository';

/**
 * Where a seller may be given an offer — the one answer, for every writer.
 *
 * ## Why this exists (2026-08-28)
 *
 * "Which destinations may this seller offer in" had two implementations that
 * disagreed, and the disagreement was a catalogue-wide defect:
 *
 * - `create-draft.ts` required an **`ACTIVE` seller market profile**. With none,
 *   its destination list was empty, its `for (const destination of …)` loop ran
 *   zero times, and the draft was created **with no `product_offers` rows at
 *   all**.
 * - `publish.ts` did `profile?.destinationCountryCode ?? destinations[0]` — it
 *   fell back to the platform capability list and created offers regardless.
 *
 * So a draft could be born offer-less and then be published perfectly well; and
 * in between, **Save Draft could not write a price to it**, because
 * `updateSellerRetailPrices` is UPDATE-only and matched no row. The save threw
 * `PricePersistenceError` and rolled the whole transaction back, taking the
 * product name, the specifications and the description with it. Twenty-five
 * drafts were in that state on 2026-08-28.
 *
 * The way in that created profiles was removed on 2026-08-20 (owner decision;
 * `market-rules/page.tsx` records it, and ADR-014 puts market governance in the
 * Admin Portal), so "make sure every seller has a profile" is not a repair
 * available from here — and restoring that screen would reverse the decision.
 * Making the two readers agree is.
 *
 * ## The fallback is one destination, not all of them
 *
 * `[destinations[0]]`, matching **exactly** what `publish.ts` already picks, and
 * deliberately not the whole authorized list: publish writes offers for one
 * destination, so a draft creating six per variant would be five rows per
 * variant that nothing ever reads, and a create/publish pair that disagree about
 * what the product is.
 *
 * ## What did not change
 *
 * A seller **with** `ACTIVE` profiles still gets exactly those, intersected with
 * the platform capability list — the original two-condition rule, comment and
 * all: narrowing the global buyer-destination policy still narrows offer
 * creation, and a stale `ACTIVE` profile for a withdrawn destination still stops
 * producing offers immediately. No market code is hardcoded here.
 *
 * ## A stale profile refuses; no profile falls back
 *
 * These are different states and only one of them may fall back.
 *
 * A seller with an `ACTIVE` profile for a destination the platform has since
 * withdrawn **has chosen** where they sell, and the choice is now unavailable.
 * Falling back would publish their product into a market they never asked for.
 * The old `publish.ts` refused that case — it read `profile.destinationCountryCode`
 * first and let `findAuthorizedDestination` return `null` — and this keeps
 * refusing it, which is the whole reason the two states are told apart here
 * rather than collapsed into "no usable profile".
 *
 * A seller with **no `ACTIVE` profile at all** has chosen nothing, so there is no
 * choice to contradict, and the platform's own list is the only answer available.
 * That is the case the removed setup screen left every seller in.
 *
 * An empty result still means "create no offer", and now says which of the two
 * reasons it is.
 */

export type OfferDestination = {
  marketCode: string;
  /**
   * `null` when the seller has no `ACTIVE` profile and the platform's own
   * capability list supplied the destination.
   *
   * `product_offers.market_profile_id` is nullable and `publish.ts` has always
   * written `profile?.id ?? null` into it, so this records the same fact the
   * publish path already records: which profile, if any, authorized this offer.
   */
  profileId: string | null;
};

export default async function resolveOfferDestinations(
  executor: Executor,
  sellerAccountId: string,
): Promise<OfferDestination[]> {
  const profiles = await listProfilesForSeller(executor, sellerAccountId);
  const active = profiles.filter((profile) => profile.status === 'ACTIVE');
  const authorized = active
    .filter(
      (profile) =>
        findAuthorizedDestination(profile.destinationCountryCode) !== null,
    )
    .map((profile) => ({
      marketCode: profile.destinationCountryCode,
      profileId: profile.id as string | null,
    }));

  if (authorized.length > 0) return authorized;

  // The seller chose destinations and the platform has withdrawn all of them.
  // Refuse rather than substitute one they never asked for.
  if (active.length > 0) return [];

  const { destinations } = resolveSellerMarketCapabilities();
  const first = destinations[0];

  return first === undefined
    ? []
    : [{ marketCode: first.destinationCountryCode, profileId: null }];
}
