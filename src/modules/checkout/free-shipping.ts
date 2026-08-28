const FREE_SHIPPING_ENV_KEYS = {
  AU: 'SALS3_FREE_STANDARD_SHIPPING_AU_USD',
  PH: 'SALS3_FREE_STANDARD_SHIPPING_PH_USD',
  FJ: 'SALS3_FREE_STANDARD_SHIPPING_FJ_USD',
} as const;

export type FreeShippingCountry = keyof typeof FREE_SHIPPING_ENV_KEYS;

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
