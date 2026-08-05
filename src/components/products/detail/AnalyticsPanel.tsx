import { formatMoney, peso } from '@/lib/money';
import type { ProductAnalytics } from '@/lib/products/types';
import MetricCard from './MetricCard';

type AnalyticsPanelProps = {
  analytics: ProductAnalytics;
};

function conversionRate(analytics: ProductAnalytics): string {
  if (analytics.views === 0) {
    return '—';
  }

  return `${((analytics.unitsSold / analytics.views) * 100).toFixed(2)}%`;
}

/**
 * Product performance. The meters are plain CSS widths: a chart library would
 * add bundle weight for five numbers, and each meter already states its value
 * in text, so nothing depends on reading the bar.
 */
export default function AnalyticsPanel({ analytics }: AnalyticsPanelProps) {
  const funnel = [
    { label: 'Views', value: analytics.views },
    { label: 'Added to cart', value: analytics.addToCart },
    { label: 'Units sold', value: analytics.unitsSold },
  ];
  const peak = Math.max(...funnel.map((step) => step.value), 1);

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Conversion rate" value={conversionRate(analytics)} />
        <MetricCard
          label="Revenue"
          value={formatMoney(peso(analytics.revenueMinor))}
        />
        <MetricCard
          label="Units sold"
          value={analytics.unitsSold.toLocaleString()}
        />
      </dl>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">From view to sale</h3>
        {funnel.map((step) => (
          <div key={step.label} className="flex flex-col gap-1">
            <div className="flex justify-between text-sm">
              <span>{step.label}</span>
              <span className="font-medium tabular-nums">
                {step.value.toLocaleString()}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-chart-1"
                style={{ width: `${Math.max((step.value / peak) * 100, 1)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {analytics.views === 0 ? (
        <p className="text-sm text-muted-foreground">
          This product has no visits yet. Numbers appear after it is published.
        </p>
      ) : null}
    </div>
  );
}
