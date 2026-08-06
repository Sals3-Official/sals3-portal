/**
 * Illustrative static data checked into this repository for interface
 * review only. This wizard shows what a listing looks like once filled in -
 * there is no backend to create or save a real listing yet. Field values,
 * percentages, and photo counts are examples, not a real Sals3 product.
 */

import type { StatusPillTone } from '@/components/seller-center/shared/StatusPill';
import type { SellerCenterMarket } from '@/lib/seller-center/market-config';
import { HS_CODE_HELP } from '@/lib/seller-center/disclosures';
import { formatMarketMoney } from '@/lib/seller-center/money';

export type ListingField = {
  label: string;
  value: string;
  needsAttention?: boolean;
  help?: string;
  wide?: boolean;
};

export type ListingStage = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  statusTone: StatusPillTone;
  fields: ListingField[];
};

export function buildListingStages(market: SellerCenterMarket): ListingStage[] {
  return [
    {
      id: 'start',
      title: 'Start',
      subtitle: 'Photos, name, price, quantity',
      status: 'Complete',
      statusTone: 'success',
      fields: [
        {
          label: 'Product name',
          value: 'Kraft bubble mailer 32 × 25cm',
          wide: true,
        },
        { label: 'Category', value: 'Packaging › Mailers & envelopes' },
        { label: 'Price', value: formatMarketMoney(24900, market) },
        { label: 'Available quantity', value: '310' },
      ],
    },
    {
      id: 'market-requirements',
      title: `${market.name} requirements`,
      subtitle: 'Only what applies to this category and market',
      status: '1 missing',
      statusTone: 'warning',
      fields: [
        {
          label: 'Seller tax ID',
          value: `${market.code} · registered`,
          wide: true,
        },
        {
          label: 'Product safety label',
          value: 'Not required for this category',
        },
        {
          label: 'HS code',
          value: 'Add before publish',
          needsAttention: true,
          help: HS_CODE_HELP,
          wide: true,
        },
      ],
    },
    {
      id: 'selling-options',
      title: 'Selling options',
      subtitle: 'Shipping profile, lead time, variants',
      status: 'Complete',
      statusTone: 'success',
      fields: [
        {
          label: 'Shipping profile',
          value: `Standard · ${market.carrierName}`,
        },
        { label: 'Lead time', value: '1 business day' },
        { label: 'Variants', value: '3 sizes · 2 colours', wide: true },
      ],
    },
    {
      id: 'quality-review',
      title: 'Quality and review',
      subtitle: 'Completeness, warnings, proceeds estimate',
      status: 'Blocked',
      statusTone: 'neutral',
      fields: [
        { label: 'Search guidance', value: '2 suggestions available' },
        { label: 'Photo quality', value: '4 of 8 recommended photos' },
      ],
    },
  ];
}

export const LISTING_COMPLETE_FIELDS = 13;
export const LISTING_TOTAL_FIELDS = 18;

export type RemainingRequirement = {
  id: string;
  label: string;
  why: string;
  required: boolean;
};

export function buildRemainingRequirements(
  market: SellerCenterMarket,
): RemainingRequirement[] {
  return [
    {
      id: 'hs-code',
      label: 'HS code',
      why: `Required because you ship this category across a border from ${market.name}.`,
      required: true,
    },
    {
      id: 'more-photos',
      label: '4 more recommended photos',
      why: 'Optional. Helps buyers find this listing.',
      required: false,
    },
    {
      id: 'search-keywords',
      label: 'Search keywords',
      why: 'Optional. Suggested from your category.',
      required: false,
    },
  ];
}

export type ProceedsLine = {
  label: string;
  amountMinor: number;
};

export function buildProceedsEstimate(market: SellerCenterMarket): {
  itemPriceMinor: number;
  lines: ProceedsLine[];
  totalMinor: number;
} {
  const itemPriceMinor = 24900;
  const commissionMinor = -2241;
  const transactionFeeMinor = -623;
  const taxMinor = -299;
  const lines: ProceedsLine[] = [
    { label: 'Item price', amountMinor: itemPriceMinor },
    { label: 'Commission (9%)', amountMinor: commissionMinor },
    { label: 'Transaction fee', amountMinor: transactionFeeMinor },
    { label: market.taxLabel, amountMinor: taxMinor },
  ];

  return {
    itemPriceMinor,
    lines,
    totalMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0),
  };
}
