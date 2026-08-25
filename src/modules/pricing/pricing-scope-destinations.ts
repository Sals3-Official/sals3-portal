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
 */
export function isPricingScopeDestination(code: string): boolean {
  return listPricingScopeDestinations().some(
    (destination) => destination.code === code,
  );
}
