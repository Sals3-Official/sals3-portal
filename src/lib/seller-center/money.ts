import type { SellerCenterMarket } from './market-config';

/**
 * Market-aware currency formatting for Seller Center's illustrative data.
 *
 * Unlike `sals3-ecommerce`'s `money.ts` (intentionally single-currency, PHP
 * only, for a PHP-only storefront), Seller Center's whole market concept
 * requires currency and locale to vary per account - so this formats
 * through `Intl.NumberFormat` against the active market's currency/locale
 * rather than a hardcoded symbol. Amounts are integer minor units (the same
 * "smallest unit, no floating point" convention used elsewhere in this
 * repo), formatted with each currency's own default fraction digits.
 */
export function formatMarketMoney(
  amountMinor: number,
  market: SellerCenterMarket,
): string {
  try {
    return new Intl.NumberFormat(market.locale, {
      style: 'currency',
      currency: market.currency,
    }).format(amountMinor / 100);
  } catch {
    return `${market.currency} ${(amountMinor / 100).toLocaleString(market.locale)}`;
  }
}

export function formatSignedMarketMoney(
  amountMinor: number,
  market: SellerCenterMarket,
): string {
  const formatted = formatMarketMoney(Math.abs(amountMinor), market);

  return amountMinor < 0 ? `−${formatted}` : formatted;
}
