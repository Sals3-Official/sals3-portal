/**
 * Illustrative sample markets carried over from the imported Seller Center
 * mockup. These three markets and every value attached to them (carrier
 * name, cutoff time, tax label, payout rail, rule version) are examples for
 * interface review only - they are not confirmed Sals3 launch markets, and
 * none of the figures are approved business rules. Do not read anything
 * here as a decided fee, tax, or logistics contract.
 *
 * `getActiveMarket()` mirrors `src/lib/auth/session.ts`'s `readDevRole()`
 * placeholder pattern: a server-only env var picks the active sample market
 * until a real per-seller market configuration exists.
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
  const raw = process.env.PORTAL_DEV_MARKET;

  return (
    SELLER_CENTER_MARKET_CODES.find((code) => code === raw) ??
    DEV_FALLBACK_MARKET
  );
}

/**
 * Placeholder, deliberately visible as one - see `session.ts`'s own comment
 * for the pattern this mirrors. Replace with a real per-seller market lookup
 * once one exists; every caller keeps working unchanged.
 */
export function getActiveMarket(): SellerCenterMarket {
  return SELLER_CENTER_MARKETS[readDevMarket()];
}

export function getAllMarkets(): SellerCenterMarket[] {
  return SELLER_CENTER_MARKET_CODES.map((code) => SELLER_CENTER_MARKETS[code]);
}
