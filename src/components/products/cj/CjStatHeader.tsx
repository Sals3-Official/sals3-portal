import { Layers, Link2, RefreshCw, Store } from 'lucide-react';

type Stat = {
  label: string;
  value: string;
  icon: typeof Layers;
};

type CjStatHeaderProps = {
  totalProducts: number;
  productsOnPage: number;
  activeConnections: number;
  fxUpdatedLabel: string;
};

/**
 * A dark stat band under the page title - the "sobrang lupit" ask, done with
 * the existing rail token (`bg-sidebar`) rather than a new colour, so it
 * still reads as this app's own navy, not a foreign accent.
 */
export default function CjStatHeader({
  totalProducts,
  productsOnPage,
  activeConnections,
  fxUpdatedLabel,
}: CjStatHeaderProps) {
  const stats: Stat[] = [
    {
      label: 'Supplier catalogue',
      value: totalProducts.toLocaleString(),
      icon: Layers,
    },
    {
      label: 'Shown on this page',
      value: productsOnPage.toLocaleString(),
      icon: Store,
    },
    {
      label: 'Active supplier apps',
      value: String(activeConnections),
      icon: Link2,
    },
    { label: 'FX rate', value: fxUpdatedLabel, icon: RefreshCw },
  ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-sidebar-border sm:grid-cols-4">
      {stats.map((stat) => {
        const Icon = stat.icon;

        return (
          <div
            key={stat.label}
            className="flex flex-col gap-1.5 bg-sidebar p-4"
          >
            <Icon aria-hidden="true" className="size-4 text-sidebar-primary" />
            <p className="font-display text-2xl font-semibold tracking-tight text-sidebar-foreground tabular-nums">
              {stat.value}
            </p>
            <p className="text-xs text-sidebar-foreground/70">{stat.label}</p>
          </div>
        );
      })}
    </div>
  );
}
