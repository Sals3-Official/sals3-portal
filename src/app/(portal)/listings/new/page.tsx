import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import ListingCompletenessRail from '@/components/seller-center/listings/ListingCompletenessRail';
import ListingProceedsEstimate from '@/components/seller-center/listings/ListingProceedsEstimate';
import ListingWizard from '@/components/seller-center/listings/ListingWizard';
import { requirePermission } from '@/lib/auth/session';
import { getActiveMarket } from '@/lib/seller-center/market-config';
import {
  LISTING_COMPLETE_FIELDS,
  LISTING_TOTAL_FIELDS,
  buildListingStages,
  buildProceedsEstimate,
  buildRemainingRequirements,
} from '@/lib/seller-center/mock-data/listings';

export const metadata: Metadata = { title: 'New listing · Seller Center' };

/**
 * New-listing wizard. Shows what a filled-in listing looks like -
 * essentials first, with market-specific requirements surfaced only when
 * they apply. No product-creation backend exists yet, so fields are
 * read-only and the bottom actions are disabled.
 */
export default async function NewListingPage() {
  await requirePermission('product:create');

  const market = getActiveMarket();
  const stages = buildListingStages(market);
  const remaining = buildRemainingRequirements(market);
  const proceeds = buildProceedsEstimate(market);
  const completePct = Math.round(
    (LISTING_COMPLETE_FIELDS / LISTING_TOTAL_FIELDS) * 100,
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="New listing"
        description="Essentials first. Requirements appear when they apply to you."
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <ListingWizard stages={stages} />
        <div className="flex flex-col gap-4">
          <ListingCompletenessRail
            completePct={completePct}
            completeFields={LISTING_COMPLETE_FIELDS}
            totalFields={LISTING_TOTAL_FIELDS}
            remaining={remaining}
          />
          <ListingProceedsEstimate
            market={market}
            lines={proceeds.lines}
            totalMinor={proceeds.totalMinor}
          />
        </div>
      </div>
    </div>
  );
}
