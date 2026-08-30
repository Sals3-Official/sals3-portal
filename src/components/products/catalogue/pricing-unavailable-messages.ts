/**
 * Seller-facing words for every reason the pricing resolver refused a price.
 *
 * The catalogue used to print "Not available" in the Selling Price cell and
 * stop. That cell is the one place a seller looks to find out whether a listing
 * can go live, and the reason it cannot is *already recorded* — the offer row
 * carries `pricing_unavailable_reason`, and a check constraint makes it
 * non-null whenever the state is `UNRESOLVED`. Not showing it was throwing away
 * an answer the database already held.
 *
 * Kept short on purpose: these render inside a table cell beneath the price, at
 * 12px, next to eleven other columns. The full sentence belongs to
 * `publish-listing-messages.ts`, which the row menu and the publish results use
 * — this is the glance version of the same fact, and the two must not disagree.
 *
 * `Record` rather than a lookup with a fallback, so a new resolver reason fails
 * to compile here instead of shipping as a blank cell.
 */
import type { PricingUnavailableReason } from '@/modules/pricing/types';

/**
 * Written before the resolver has run at all — by `create-draft` and by the
 * offer backfill. It is not one of the resolver's own verdicts, which is why it
 * is not in `PricingUnavailableReason`, and it means something different from
 * every reason that is: nothing is wrong yet, nobody has asked.
 */
export const PRICING_NOT_ATTEMPTED = 'PRICING_NOT_ATTEMPTED';

const MESSAGES: Record<PricingUnavailableReason, string> = {
  CATEGORY_NOT_FOUND: 'No Sals3 category',
  CATEGORY_MAPPING_REQUIRES_REVIEW: 'Category needs review',
  CATEGORY_POLICY_REQUIRED: 'No margin for this category',
  PRICING_POLICY_REQUIRED: 'No pricing policy',
  MARKET_REQUIRED: 'No active market',
  CONTRIBUTION_FLOOR_CURRENCY_MISMATCH: 'Floor is in another currency',
  SUPPLIER_COST_UNAVAILABLE: 'No supplier cost observed',
  REFERENCE_FX_UNAVAILABLE: 'No reference FX rate',
  FUNDING_BUFFER_REQUIRED: 'No funding buffer set',
  FUNDING_BUFFER_EXPIRED: 'Funding buffer expired',
  INVALID_MARGIN_RATE: 'Margin rate is invalid',
};

/**
 * The glance reason, or `null` when there is nothing honest to say.
 *
 * `null` for an unrecognised code rather than the code itself: a seller reading
 * `CONTRIBUTION_FLOOR_CURRENCY_MISMATCH` in a table cell learns nothing they
 * could not have guessed from the empty price, and printing a database token at
 * them is worse than printing nothing. The cell then falls back to saying only
 * that no price is set, which remains true.
 */
export default function describePricingUnavailable(
  reason: string | null,
): string | null {
  if (reason === null) return null;
  if (reason === PRICING_NOT_ATTEMPTED) return 'Not priced yet';

  return MESSAGES[reason as PricingUnavailableReason] ?? null;
}
