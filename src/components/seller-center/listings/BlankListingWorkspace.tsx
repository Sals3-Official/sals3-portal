import ListingCompletenessRail from '@/components/seller-center/listings/ListingCompletenessRail';
import ListingProceedsEstimate from '@/components/seller-center/listings/ListingProceedsEstimate';
import ListingWizard from '@/components/seller-center/listings/ListingWizard';
import MarketNotConfiguredNotice from '@/components/seller-center/shared/MarketNotConfiguredNotice';
import { getActiveMarket } from '@/lib/seller-center/market-config';
import {
  LISTING_COMPLETE_FIELDS,
  LISTING_TOTAL_FIELDS,
  buildListingStages,
  buildProceedsEstimate,
  buildRemainingRequirements,
} from '@/lib/seller-center/mock-data/listings';

/**
 * The blank "Add Product" path - the essentials-first wizard that was this
 * route's whole content before the supplier-prefilled Product Editor was
 * added beside it. Unchanged in behaviour; it moved out of `page.tsx` only
 * so that file stays a composition/dispatch shell.
 *
 * Shows what a filled-in listing looks like. No product-creation backend
 * exists yet, so fields are read-only and the bottom actions are disabled.
 */
export default function BlankListingWorkspace() {
  const market = getActiveMarket();

  if (market === null) {
    return <MarketNotConfiguredNotice />;
  }

  const stages = buildListingStages(market);
  const remaining = buildRemainingRequirements(market);
  const proceeds = buildProceedsEstimate(market);
  const completePct = Math.round(
    (LISTING_COMPLETE_FIELDS / LISTING_TOTAL_FIELDS) * 100,
  );

  return (
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
  );
}
