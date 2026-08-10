import { Eye, Heart, ShoppingBag, Star } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatCount } from '@/lib/seller-center/product-editor/format';
import type { CatalogueProductFixture } from '@/lib/seller-center/product-catalogue/types';

type MicroMetricBadgesProps = {
  product: CatalogueProductFixture;
};

type MetricProps = {
  icon: typeof Eye;
  value: string;
  label: string;
  tip: string;
};

function Metric({ icon: Icon, value, label, tip }: MetricProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={`${label}: ${value}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {value}
          </span>
        }
      />
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Four fictional engagement figures - see `product-catalogue/types.ts` for
 * why none of these have a real backend yet. Rating renders "-" rather than
 * a fabricated 0 when a product has no ratings, matching this repo's
 * established "a missing figure is never a zero" rule.
 */
export default function MicroMetricBadges({ product }: MicroMetricBadgesProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Metric
        icon={ShoppingBag}
        value={formatCount(product.unitsSold30d)}
        label="Units sold in the last 30 days"
        tip="Total units sold in the last 30 days across all SKUs."
      />
      <Metric
        icon={Heart}
        value={formatCount(product.wishlistCount30d)}
        label="Wishlist adds in the last 30 days"
        tip="Total times this product was added to wishlist in the last 30 days."
      />
      <Metric
        icon={Eye}
        value={formatCount(product.pageViews30d)}
        label="Page views in the last 30 days"
        tip="Total product detail page views in the last 30 days."
      />
      <Metric
        icon={Star}
        value={
          product.ratingAverage === null
            ? '-'
            : product.ratingAverage.toFixed(1)
        }
        label="Average product rating"
        tip="Average rating score. Shows “-” when the product has no ratings yet."
      />
    </div>
  );
}
