import { Skeleton } from '@/components/ui/skeleton';

type PricingSectionFallbackProps = {
  /** Announced while the section loads, e.g. "Category margins". */
  label: string;
  /** How many placeholder rows to draw. One card needs far fewer than a tree. */
  rows?: number;
};

/**
 * The placeholder one pricing section shows while it loads, so the other
 * sections do not wait for it.
 *
 * This exists because of a measured problem, not for polish. Both sections on
 * Market Rules were awaited in a single route render, and
 * `CategoryPricingSection` — a scan of the whole taxonomy plus one store-default
 * read per destination — came first. Every save anywhere on the page, including
 * a one-line funding-buffer change, re-rendered behind that scan before the
 * seller saw anything move. The save had already landed; the page just could
 * not say so yet, which reads as "it did not work" and invites a manual reload.
 *
 * A boundary per section lets the cheap one flush immediately and the expensive
 * one arrive when it is ready.
 */
export default function PricingSectionFallback({
  label,
  rows = 3,
}: PricingSectionFallbackProps) {
  return (
    <section
      role="status"
      aria-live="polite"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <span className="sr-only">Loading {label}</span>
      <Skeleton className="h-5 w-40" aria-hidden="true" />
      <Skeleton className="h-4 w-full max-w-xl" aria-hidden="true" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_row, index) => (
          <Skeleton key={index} className="h-10 w-full" aria-hidden="true" />
        ))}
      </div>
    </section>
  );
}
