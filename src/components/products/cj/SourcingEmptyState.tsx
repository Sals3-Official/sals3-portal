import { PackageSearch, type LucideIcon } from 'lucide-react';

type SourcingEmptyStateProps = {
  title: string;
  description: string;
  icon?: LucideIcon;
};

/**
 * Shared empty state for the Product Sourcing pages. Never mock data - the
 * icon tile is decorative, not a stand-in for a real stat. A bento-style
 * pairing (accent tile + message tile) instead of one plain centered block.
 */
export default function SourcingEmptyState({
  title,
  description,
  icon: Icon = PackageSearch,
}: SourcingEmptyStateProps) {
  return (
    <div className="grid animate-in fade-in slide-in-from-bottom-2 grid-cols-1 gap-3 duration-300 sm:grid-cols-[10rem_1fr]">
      <div className="relative flex items-center justify-center overflow-hidden rounded-lg border border-border bg-primary/5 py-10 sm:py-0">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] [background-size:16px_16px] opacity-50"
        />
        <Icon aria-hidden="true" className="relative size-10 text-primary" />
      </div>
      <div className="flex flex-col justify-center rounded-lg border border-border bg-card px-6 py-10 text-center sm:text-left">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
