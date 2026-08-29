import {
  listPricingScopeDestinations,
  type PricingScopeDestination,
} from '@/modules/pricing/pricing-scope-destinations';

/**
 * The destinations a buyer can actually complete a purchase to.
 *
 * ## Why this is not the same list as the other two
 *
 * Three lists in this repository answer three different questions, and they
 * currently give three different answers:
 *
 * - `resolveBuyerDestinationCountryPolicy()` — six countries a candidate may be
 *   *screened* for (`AU NZ PH US CA FJ`, owner decision 2026-08-25).
 * - `listPricingScopeDestinations()` — the same six, because a margin may be set
 *   for any of them.
 * - **this one** — the three that can be checked out to.
 *
 * The third is narrower because `freight-quotes.ts` can only quote `AU`, `PH`
 * and `FJ`. A buyer in New Zealand can browse and can be priced, and then gets
 * no freight quote at all, so no order can be created. Offering a *storefront
 * preview* for such a country would be showing a seller a shop nobody can buy
 * from.
 *
 * ## Why the codes live here rather than in `freight-quotes.ts`
 *
 * They were already written down twice — `CHECKOUT_FREIGHT_COUNTRIES` in
 * `freight-quotes.ts` and the keys of `FREE_SHIPPING_ENV_KEYS` in
 * `free-shipping.ts` — and this file would have made three. This module is the
 * one home: it imports nothing but the label list, so a checkout module, a
 * server action and a client component can all read it without dragging a CJ
 * client or a database into their graph.
 *
 * Adding a code here is not what opens a market. A destination becomes
 * checkout-capable when freight can be quoted for it, a free-shipping threshold
 * is configured, and its address rules are written — the 2026-08-28 Fiji work
 * is the worked example. This list records that decision; it does not make it.
 */
export const CHECKOUT_DESTINATION_CODES = ['AU', 'PH', 'FJ'] as const;

export type CheckoutDestinationCode =
  (typeof CHECKOUT_DESTINATION_CODES)[number];

/**
 * The checkout destinations with their display names.
 *
 * Labels are taken from `listPricingScopeDestinations()` rather than written
 * again, so "Philippines" is spelled once. A code that is not in that list is
 * dropped rather than rendered as a bare `FJ`: the only way that can happen is
 * the global buyer-destination policy being narrowed or disabled underneath
 * this list, and in that case the destination genuinely is not offerable and
 * must not appear in a preview.
 */
export function listCheckoutDestinations(): PricingScopeDestination[] {
  const byCode = new Map(
    listPricingScopeDestinations().map((destination) => [
      destination.code,
      destination,
    ]),
  );

  return CHECKOUT_DESTINATION_CODES.flatMap((code) => {
    const destination = byCode.get(code);

    return destination === undefined ? [] : [destination];
  });
}
