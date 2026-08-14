import type { MoneyValue } from './types';

/**
 * Formatting for the Product Editor.
 *
 * Everything is formatted through `Intl` against a fixed locale and time
 * zone rather than the viewer's. That is deliberate: this screen renders on
 * the server and hydrates on the client, and a locale- or zone-dependent
 * string would differ between the two and produce a hydration mismatch.
 * Timestamps therefore print their zone so the value is unambiguous rather
 * than quietly wrong.
 *
 * `src/lib/seller-center/money.ts` is not reused here: it formats against
 * an active *market's* currency and locale, and these values are supplier
 * costs and seller retail prices whose currency comes from the source
 * connection, not from the buyer's market.
 */

const FORMATTING_LOCALE = 'en-US';
const FORMATTING_TIME_ZONE = 'UTC';

/** Missing seller-facing value. Never rendered as `0`. */
export const NOT_AVAILABLE_LABEL = 'Not available';

/**
 * Minor units are scaled by each currency's own fraction digits, so a
 * zero-decimal currency (JPY) is not silently divided by 100.
 */
export function formatMoney(money: MoneyValue): string {
  const formatter = new Intl.NumberFormat(FORMATTING_LOCALE, {
    style: 'currency',
    currency: money.currency,
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;

  return formatter.format(money.amountMinor / 10 ** digits);
}

/**
 * How many minor units make one major unit for a currency, so a numeric
 * input can round-trip an amount without assuming two decimal places.
 */
export function minorUnitDigits(currency: string): number {
  return (
    new Intl.NumberFormat(FORMATTING_LOCALE, {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

export function minorToDecimalString(
  amountMinor: number,
  currency: string,
): string {
  const digits = minorUnitDigits(currency);

  return (amountMinor / 10 ** digits).toFixed(digits);
}

export function decimalStringToMinor(value: string, currency: string): number {
  const parsed = Number.parseFloat(value);

  if (Number.isNaN(parsed)) return 0;

  return Math.round(parsed * 10 ** minorUnitDigits(currency));
}

/** Collapses to a single value when both ends are equal. */
export function formatMoneyRange(min: MoneyValue, max: MoneyValue): string {
  if (min.currency !== max.currency) {
    return `${formatMoney(min)} – ${formatMoney(max)}`;
  }

  if (min.amountMinor === max.amountMinor) {
    return formatMoney(min);
  }

  return `${formatMoney(min)} – ${formatMoney(max)}`;
}

export function formatDateTime(iso: string): string {
  return `${new Intl.DateTimeFormat(FORMATTING_LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: FORMATTING_TIME_ZONE,
  }).format(new Date(iso))} UTC`;
}

export function formatPercent(value: number): string {
  return `${new Intl.NumberFormat(FORMATTING_LOCALE, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat(FORMATTING_LOCALE).format(value);
}

export function formatPixels(width: number, height: number): string {
  return `${formatCount(width)} × ${formatCount(height)} px`;
}
