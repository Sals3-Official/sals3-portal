/**
 * The currency a buyer in each destination thinks in — for DISPLAY ONLY.
 *
 * ## What this is not
 *
 * It is not `authorizedSellingCurrencyCodes`, and it must never be copied
 * there. That list is what a seller may publish a price in, and every
 * destination carries `['USD']` because ADR-003 phase 1 is USD-only.
 * `capabilities.ts` says why in its own words: a display dimension is "not a
 * checkout, settlement, or conversion contract for a buyer destination — so it
 * must not be copied in as if a seller had been approved to sell in it".
 *
 * It is also not `modules/pricing/reference-fx.ts`, which refuses every
 * non-identity pair on purpose because no reference-FX provider is approved for
 * the Portal's *pricing* surface. Nothing here reaches the resolver, is stored
 * on an offer, or decides what anybody is charged.
 *
 * ## What it is
 *
 * A seller looking at `$14.79` for Fiji cannot tell whether that is a sane
 * shelf price there. An approximate FJ$ figure answers that, the same way the
 * storefront already shows buyers an approximate local amount beside a USD
 * price. Owner request 2026-08-30.
 *
 * ## Global is USD, and that is a decision rather than a fallback
 *
 * Global is every country with no column of its own, so there is no single
 * currency its buyers think in. Owner decision 2026-08-30: show it in USD,
 * which is also what is actually charged. Returning `null` here would have the
 * row silently lose its money column.
 */

/** Destination code to the currency its buyers price in. `null` means show USD. */
const DISPLAY_CURRENCY_BY_DESTINATION: Readonly<Record<string, string>> = {
  AU: 'AUD',
  PH: 'PHP',
  NZ: 'NZD',
  US: 'USD',
  CA: 'CAD',
  FJ: 'FJD',
};

/** The key the pricing screens use for the Global scope. Not a country code. */
export const GLOBAL_DISPLAY_CODE = 'GLOBAL';

/**
 * The display currency for a destination, or `null` when there is nothing to
 * convert to — the destination already thinks in USD, or is not one we name.
 *
 * `null` rather than `'USD'` so a caller can tell "no conversion needed" from
 * "converted, and it came out the same", which are different things to render.
 */
export function displayCurrencyFor(destinationCode: string): string | null {
  const currency = DISPLAY_CURRENCY_BY_DESTINATION[destinationCode];

  if (currency === undefined || currency === 'USD') return null;

  return currency;
}

/** Every non-USD currency this screen may ask for, for a single rate fetch. */
export function displayCurrencies(): string[] {
  return [
    ...new Set(
      Object.values(DISPLAY_CURRENCY_BY_DESTINATION).filter(
        (currency) => currency !== 'USD',
      ),
    ),
  ];
}
