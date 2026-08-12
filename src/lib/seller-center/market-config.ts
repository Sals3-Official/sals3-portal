/**
 * Illustrative sample markets carried over from the imported Seller Center
 * mockup. These three markets and every value attached to them (carrier
 * name, cutoff time, tax label, payout rail, rule version) are examples for
 * interface review only - they are not confirmed Sals3 launch markets, and
 * none of the figures are approved business rules. Do not read anything
 * here as a decided fee, tax, or logistics contract. In particular, this
 * illustrative fixture set is unrelated to the real
 * `src/lib/country-policy/` seller-operating-country and buyer-destination-
 * country resolvers (ADR-014): switching this dev display never changes
 * either real policy or `intended_market_codes`.
 *
 * NOT the source of truth for a seller's real market configuration. That now
 * lives in `seller_market_profiles` behind `src/modules/market-config/`, and
 * the Market Rules screen reads it instead of anything in this file.
 *
 * Remaining callers of this fixture, honestly stated — each still renders
 * `MarketNotConfiguredNotice` in production because `getActiveMarket()`
 * returns `null` there, so none of them shows invented data to a real
 * seller, but none has been migrated to the real profile either:
 *
 * - `app/(portal)/finances/page.tsx`, `payouts/page.tsx`
 *   — `getActiveMarket()` for currency/payout/carrier display.
 * - `components/seller-center/listings/BlankListingWorkspace.tsx` — same.
 * - `components/products/catalog/{ActiveFilterChips,CatalogFilterDrawer}.tsx`
 *   and `lib/products/catalog-filters.ts` — `getAllMarkets()` /
 *   `SELLER_CENTER_MARKET_CODES` as the destination-filter vocabulary. Note
 *   this vocabulary (PH/ID/SG) does not match the real approved destinations
 *   (AU/PH); reconciling it is follow-up work, not part of this change.
 *
 * Moving those screens onto the real profile is deliberately out of scope
 * here — each needs its own product decision about what to show when an
 * account has no active destination.
 *
 * `getActiveMarket()` mirrors `src/lib/auth/session.ts`'s `readDevRole()`
 * placeholder pattern: a server-only env var picks the active sample market
 * until a real per-seller market configuration exists. Like that pattern,
 * the env var is inert outside `NODE_ENV === 'production'` - it can change
 * which illustrative fixture is displayed in development, never anything a
 * real seller or buyer sees in production.
 */

export const SELLER_CENTER_MARKET_CODES = ['PH', 'ID', 'SG'] as const;

export type SellerCenterMarketCode =
  (typeof SELLER_CENTER_MARKET_CODES)[number];

export type SellerCenterMarket = {
  code: SellerCenterMarketCode;
  name: string;
  currency: string;
  locale: string;
  timeZone: string;
  carrierName: string;
  cutoffTime: string;
  taxLabel: string;
  payoutRail: string;
  payoutRailMask: string;
  payoutThresholdMinor: number;
  payoutVerifiedDate: string;
  ruleVersion: string;
  dailyPayoutSupported: boolean;
  dailyPayoutNote: string;
};

const SELLER_CENTER_MARKETS: Record<
  SellerCenterMarketCode,
  SellerCenterMarket
> = {
  PH: {
    code: 'PH',
    name: 'Philippines',
    currency: 'PHP',
    locale: 'en-PH',
    timeZone: 'Asia/Manila',
    carrierName: 'J&T Express',
    cutoffTime: '16:00',
    taxLabel: 'withholding tax',
    payoutRail: 'GCash wallet',
    payoutRailMask: '•••• 4821',
    payoutThresholdMinor: 50000,
    payoutVerifiedDate: '2026-03-12',
    ruleVersion: 'v2026.07-ph',
    dailyPayoutSupported: true,
    dailyPayoutNote:
      'Daily payout is available above threshold on business days.',
  },
  ID: {
    code: 'ID',
    name: 'Indonesia',
    currency: 'IDR',
    locale: 'id-ID',
    timeZone: 'Asia/Jakarta',
    carrierName: 'JNE Reguler',
    cutoffTime: '15:00',
    taxLabel: 'PPN',
    payoutRail: 'Bank BCA',
    payoutRailMask: '•••• 6110',
    payoutThresholdMinor: 10000000,
    payoutVerifiedDate: '2026-02-04',
    ruleVersion: 'v2026.05-id',
    dailyPayoutSupported: false,
    dailyPayoutNote:
      'Daily payout is not supported by the local settlement window.',
  },
  SG: {
    code: 'SG',
    name: 'Singapore',
    currency: 'SGD',
    locale: 'en-SG',
    timeZone: 'Asia/Singapore',
    carrierName: 'Ninja Van',
    cutoffTime: '17:00',
    taxLabel: 'GST',
    payoutRail: 'DBS current account',
    payoutRailMask: '•••• 0093',
    payoutThresholdMinor: 2000,
    payoutVerifiedDate: '2026-01-28',
    ruleVersion: 'v2026.06-sg',
    dailyPayoutSupported: false,
    dailyPayoutNote: 'Daily payout excludes weekends and public holidays.',
  },
};

const DEV_FALLBACK_MARKET: SellerCenterMarketCode = 'PH';

function readDevMarket(): SellerCenterMarketCode {
  // Production authority must never come from an env var a developer can
  // set locally - see the module doc comment.
  if (process.env.NODE_ENV === 'production') return DEV_FALLBACK_MARKET;

  const raw = process.env.PORTAL_DEV_MARKET;

  return (
    SELLER_CENTER_MARKET_CODES.find((code) => code === raw) ??
    DEV_FALLBACK_MARKET
  );
}

/**
 * Placeholder, deliberately visible as one - see `session.ts`'s own comment
 * for the pattern this mirrors. Returns `null` in production rather than a
 * fallback sample market (Codex review fix): production must never present
 * PH, ID, SG, or any other illustrative market as real seller configuration.
 * Every real caller (`orders`/`finances`/`payouts`/`market-rules` pages,
 * the blank listing wizard) must render an honest not-configured state -
 * see `MarketNotConfiguredNotice` - instead of a fixture market when this
 * returns `null`. Replace with a real per-seller market lookup once one
 * exists.
 */
export function getActiveMarket(): SellerCenterMarket | null {
  if (process.env.NODE_ENV === 'production') return null;

  return SELLER_CENTER_MARKETS[readDevMarket()];
}

export function getAllMarkets(): SellerCenterMarket[] {
  return SELLER_CENTER_MARKET_CODES.map((code) => SELLER_CENTER_MARKETS[code]);
}
