import { resolveSellerMarketCapabilities } from '@/modules/market-config/capabilities';

/**
 * The destinations a **margin** may be set for.
 *
 * Derived from `resolveSellerMarketCapabilities()` rather than listed again
 * here. Owner decision 2026-08-25 opened all six measured destinations as real
 * buyer destinations (`buyer-destination-country` v3), which made a separate
 * pricing list a second copy of the same six — and two lists that agree today
 * are two lists that drift tomorrow.
 *
 * ## Why this file still exists
 *
 * It names the *question*. "Which destinations may carry a margin" and "which
 * destinations may a buyer order from" are different questions that currently
 * share an answer. Callers ask this one, so if they ever diverge again — a
 * destination approved for selling but not yet worth pricing separately, or the
 * reverse — this is where that divergence goes, and no screen has to change.
 *
 * ## What it does not do
 *
 * It approves nothing. A destination is offerable because the global
 * buyer-destination policy and the pilot capability list both admit it, and
 * each still reports payments, logistics, tax and payout as pending. A margin
 * scoped to one of them prices nothing until a product is actually published
 * into it — `publishProduct` resolves its own market from
 * `seller_market_profiles`, not from here.
 *
 * The six are the destinations Sals3 has measured real freight for (2026-08-24,
 * CJ Shipping Calculator, origin China, 300 g basket): PH $3.70 · CA $6.81 ·
 * US $7.62 · AU $8.10 · NZ $8.38 · FJ $16.01. Those spreads are the reason
 * per-destination margins exist at all.
 */

export type PricingScopeDestination = {
  /** ISO 3166-1 alpha-2, matching the `^[A-Z]{2}$` both policy tables enforce. */
  code: string;
  label: string;
};

export function listPricingScopeDestinations(): PricingScopeDestination[] {
  return resolveSellerMarketCapabilities().destinations.map((destination) => ({
    code: destination.destinationCountryCode,
    label: destination.destinationName,
  }));
}

/**
 * Whether a code may be used as a pricing scope.
 *
 * The gate for the URL and for every write, so a crafted `?destination=` or a
 * hand-edited CSV cannot store a scope the screen never offered. Deliberately
 * an allow list rather than "any two letters": a typo should be refused, not
 * stored as a destination nobody will ever price for and nobody will notice.
 *
 * Answers **false for Global**, which is not a country and is never carried in
 * a `market_code`. Callers deciding whether a *scope key* is legitimate want
 * `pricingScopeMarketCode()`; this one answers only "is this a named
 * destination".
 */
export function isPricingScopeDestination(code: string): boolean {
  return listPricingScopeDestinations().some(
    (destination) => destination.code === code,
  );
}

/**
 * The key the screens and the CSV use for the Global scope.
 *
 * Deliberately **not** a country code. `market_code` is `NULL` in the database
 * for a Global rule, and `null` is not a value a URL, a table column key or a
 * CSV cell can carry unambiguously — a blank cell is indistinguishable from a
 * missing one at a glance. This constant is that null's name at the edges, and
 * `pricingScopeMarketCode()` is the only place the two representations meet.
 *
 * It must never enter `PILOT_DESTINATIONS` or the buyer-destination policy:
 * `destinationCountryCode` is consumed as a real country by `publishProduct`
 * and written onto `product_offers.market_code`, and a non-country there would
 * publish a product into a market no carrier can quote.
 */
export const GLOBAL_PRICING_SCOPE_KEY = 'GLOBAL';

/**
 * A destination column, or Global.
 *
 * `marketCode` is what gets stored: a country code for the six, `null` for
 * Global. Owner decision 2026-08-27.
 */
export type PricingScope = {
  key: string;
  label: string;
  marketCode: string | null;
  isGlobal: boolean;
};

/**
 * Every scope a margin may be set for: the six measured destinations, then
 * Global.
 *
 * **Global is last on purpose.** `publishProduct` uses `destinations[0]` as its
 * fallback publication market, and while that reads from
 * `listPricingScopeDestinations()` rather than from here, the two lists are
 * close enough that ordering deserves to be deliberate in both.
 */
export function listPricingScopes(): PricingScope[] {
  return [
    ...listPricingScopeDestinations().map((destination) => ({
      key: destination.code,
      label: destination.label,
      marketCode: destination.code,
      isGlobal: false,
    })),
    {
      key: GLOBAL_PRICING_SCOPE_KEY,
      label: 'Global',
      marketCode: null,
      isGlobal: true,
    },
  ];
}

/**
 * The `market_code` a scope key stores, or `undefined` when the key is not a
 * scope this seller may price for.
 *
 * `undefined` rather than `null` for the refusal, because `null` is a valid
 * answer here — it is Global. Callers must test with `=== undefined`, never for
 * falsiness.
 */
export function pricingScopeMarketCode(key: string): string | null | undefined {
  if (key === GLOBAL_PRICING_SCOPE_KEY) return null;
  return isPricingScopeDestination(key) ? key : undefined;
}

/**
 * Whether a buyer destination falls to the Global rule.
 *
 * Owner decision 2026-08-27: **Global covers only the countries with no column
 * of their own.** A destination Sals3 has named and measured never silently
 * takes the everywhere-else rate — if its column is blank it cannot price, and
 * the screen already says so. The alternative (Global as a fallback for any
 * unset destination) was considered and refused: it would let one number price
 * Australia again, which is the exact thing per-destination margins exist to
 * stop.
 *
 * A buyer whose country *is* one of the six is routed to that country's own
 * scope, so this can only ever answer true for a country Sals3 has not named.
 */
export function isGlobalPricingDestination(marketCode: string): boolean {
  return !isPricingScopeDestination(marketCode);
}
