/**
 * Formats an order amount against the currency stored on the order row.
 *
 * Deliberately **not** `lib/seller-center/money.ts`, which formats against the
 * seller's active market. An order was charged in a particular currency at a
 * particular moment, and that fact is frozen on the row; resolving it through
 * a market profile instead would let a settings change today restate what a
 * buyer paid last month. It also keeps the orders screens free of the market
 * configuration `fixture-independence.test.ts` keeps out of them.
 *
 * No `server-only`: the parcel card and the bulk bar are client components and
 * need the same rule the server-side read model uses. One home for it, so the
 * two surfaces cannot format the same amount differently.
 *
 * Amounts are integer minor units, the convention used throughout this repo.
 * An unknown or malformed currency code falls back to `CODE 12.34` rather than
 * throwing, because a money label is never worth taking a page down for.
 */
export default function formatParcelMoney(
  amountMinor: number,
  currency: string,
): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}
