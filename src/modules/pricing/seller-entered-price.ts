/**
 * Was this offer's price typed by a person, rather than resolved from a rule?
 *
 * ## Why this is a function and not an `===`
 *
 * Two different writers record the same fact in two different shapes, and
 * neither is going to be migrated for the sake of a tidier check:
 *
 * - `publishProduct`'s manual branch stores a decision object carrying
 *   `resolvedLayer: 'SELLER_RETAIL_PRICE'`.
 * - `updateSellerRetailPrices` — the draft save, which writes the price
 *   straight onto the offer row — stores `{ source: 'SELLER_RETAIL_PRICE' }`
 *   with **no** `resolvedLayer` at all.
 *
 * Both also stamp `pricing_resolver_version = 'SELLER_RETAIL_PRICE_V1'`, which
 * is the one signal present on every row either writer produced, so it is
 * checked first and the two decision shapes are the belt to its braces.
 *
 * ## What it is load-bearing for
 *
 * Everything that must not overwrite a deliberate decision: the repricer skips
 * these offers, and the Product Editor keeps showing the seller's own number
 * instead of replacing it with the rule's. A check that recognised only the
 * publish-time shape would have quietly repriced every price entered through a
 * draft save — the majority of them.
 */

const SELLER_RETAIL_PRICE = 'SELLER_RETAIL_PRICE';
const SELLER_RETAIL_PRICE_VERSION = 'SELLER_RETAIL_PRICE_V1';

// eslint-disable-next-line import/prefer-default-export -- the name is the point at every call site.
export function isSellerEnteredPrice(
  pricingDecision: unknown,
  pricingResolverVersion?: string | null,
): boolean {
  if (pricingResolverVersion === SELLER_RETAIL_PRICE_VERSION) return true;

  if (pricingDecision === null || typeof pricingDecision !== 'object') {
    return false;
  }

  const decision = pricingDecision as {
    resolvedLayer?: unknown;
    source?: unknown;
  };

  return (
    decision.resolvedLayer === SELLER_RETAIL_PRICE ||
    decision.source === SELLER_RETAIL_PRICE
  );
}
