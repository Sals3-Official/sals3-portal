import type { CheckoutDestinationCode } from '@/modules/market-config/checkout-destinations';

/**
 * Keyed by `CheckoutDestinationCode` rather than by three free-standing
 * strings, so opening a fourth checkout destination fails to compile here
 * instead of silently shipping a market with no threshold. The three codes
 * themselves live in `checkout-destinations.ts`.
 */
const FREE_SHIPPING_ENV_KEYS: Record<CheckoutDestinationCode, string> = {
  AU: 'SALS3_FREE_STANDARD_SHIPPING_AU_USD',
  PH: 'SALS3_FREE_STANDARD_SHIPPING_PH_USD',
  FJ: 'SALS3_FREE_STANDARD_SHIPPING_FJ_USD',
};

/**
 * Optional. Unset in every environment today — no Vercel var exists for
 * these yet — so reading one is never allowed to throw the way a missing
 * threshold does; see `freeShippingCeilingAmountMinor`.
 */
const FREE_SHIPPING_CEILING_ENV_KEYS: Record<CheckoutDestinationCode, string> =
  {
    AU: 'SALS3_FREE_STANDARD_SHIPPING_CEILING_AU_USD',
    PH: 'SALS3_FREE_STANDARD_SHIPPING_CEILING_PH_USD',
    FJ: 'SALS3_FREE_STANDARD_SHIPPING_CEILING_FJ_USD',
  };

export type FreeShippingCountry = CheckoutDestinationCode;

export type FreeShippingProgress = {
  thresholdAmountMinor: number;
  subtotalAmountMinor: number;
  amountRemainingMinor: number;
  eligible: boolean;
  currency: 'USD';
};

function usdMajorToMinor(raw: string | undefined, key: string): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(raw ?? '');

  if (match === null) {
    throw new Error(
      `${key} must be a positive USD amount with at most 2 decimals.`,
    );
  }

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const amountMinor = whole * 100 + fraction;

  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error(
      `${key} must be a positive USD amount with at most 2 decimals.`,
    );
  }

  return amountMinor;
}

export function freeShippingThresholdAmountMinor(
  country: FreeShippingCountry,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const key = FREE_SHIPPING_ENV_KEYS[country];

  return usdMajorToMinor(environment[key], key);
}

/**
 * The most Sals3 will contribute toward one order's Standard freight, once
 * eligible. Unlike the threshold, this fails **open** on a missing
 * environment variable rather than throwing: no `SALS3_FREE_STANDARD_
 * SHIPPING_CEILING_*` var exists in production today, and this function
 * must be safe to deploy before anyone adds one.
 *
 * The zero-config default is the qualifying threshold itself — Sals3 never
 * gives away more in Standard freight than the spend that earned it. For
 * every real quote seen so far (AU ~$8, PH ~$4, FJ ~$16 at a normal basket)
 * that default changes nothing, because the quote is already far under the
 * threshold. It only starts capping an unusually heavy basket, which is
 * exactly the case with no ceiling at all today: a qualifying Fiji order
 * whose real CJ freight reaches $49.90–$98.32 currently has nothing
 * stopping it from being given away in full.
 */
export function freeShippingCeilingAmountMinor(
  country: FreeShippingCountry,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const key = FREE_SHIPPING_CEILING_ENV_KEYS[country];
  const raw = environment[key];

  if (raw === undefined) {
    return freeShippingThresholdAmountMinor(country, environment);
  }

  return usdMajorToMinor(raw, key);
}

/**
 * Sals3's contribution toward one order's total Standard freight, capped at
 * `freeShippingCeilingAmountMinor`. `totalStandardAmountMinor` is the sum of
 * every package's real Standard-tier quote in the order — a split-warehouse
 * order ships as more than one package, and the cap applies to the order,
 * not to each package independently.
 */
export function freeShippingContributionMinor(
  country: FreeShippingCountry,
  totalStandardAmountMinor: number,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const ceiling = freeShippingCeilingAmountMinor(country, environment);
  const normalizedTotal = Math.max(0, Math.trunc(totalStandardAmountMinor));

  return Math.min(normalizedTotal, ceiling);
}

/**
 * Resolves the buyer-facing promotion from Portal-owned, current offer prices.
 *
 * Thresholds come only from Portal server environment. The browser receives
 * the result but never decides eligibility. Checkout re-quotes through this
 * same function before creating an intent, so an edited cart blob or stale
 * delivery screen cannot turn paid freight into free freight.
 */
export function freeShippingProgress(
  country: FreeShippingCountry,
  subtotalAmountMinor: number,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): FreeShippingProgress {
  const thresholdAmountMinor = freeShippingThresholdAmountMinor(
    country,
    environment,
  );
  const normalizedSubtotal = Math.max(0, Math.trunc(subtotalAmountMinor));
  const amountRemainingMinor = Math.max(
    0,
    thresholdAmountMinor - normalizedSubtotal,
  );

  return {
    thresholdAmountMinor,
    subtotalAmountMinor: normalizedSubtotal,
    amountRemainingMinor,
    eligible: amountRemainingMinor === 0,
    currency: 'USD',
  };
}
