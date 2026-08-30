'use client';

import { CheckCircle2, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type PublishOutcome = {
  productId: string;
  name: string;
  /** The public path, on success. */
  slug?: string;
  offerCount?: number;
  /** Seller-facing sentence, on refusal. */
  failure?: string;
};

type CataloguePublishResultsProps = {
  outcomes: PublishOutcome[];
  onDismiss: () => void;
};

/**
 * What a bulk publish actually did, product by product.
 *
 * ## Why this is a panel and not a toast
 *
 * Publishing is refused per product, for one of eighteen named reasons — no
 * supplier cost observed, no Sals3 category chosen, no approved image, a retail
 * price under the 2.5% floor, no active market profile. A toast reading "2
 * failed" names no product and no reason and is gone before it can be read,
 * which on a screen whose whole job is getting listings live is the version of
 * this that wastes a morning.
 *
 * Every refusal already has seller-facing words in
 * `publish-listing-messages.ts`, written for the row's action menu. This reuses
 * them rather than inventing a second vocabulary, so the sentence a seller sees
 * here is the sentence they saw there.
 *
 * ## Why it stays until dismissed
 *
 * It is a work list. The seller reads it, goes and fixes one product, and comes
 * back — a panel that faded on a timer would make them run the publish again
 * just to re-read what it said.
 *
 * Successes are listed too, not just counted. A run where four of five worked
 * should show which four: "1 refused" leaves the other four ambiguous, and a
 * seller checking whether a specific listing went live should not have to go
 * looking.
 */
export default function CataloguePublishResults({
  outcomes,
  onDismiss,
}: CataloguePublishResultsProps) {
  if (outcomes.length === 0) return null;

  const published = outcomes.filter((outcome) => outcome.failure === undefined);
  const refused = outcomes.filter((outcome) => outcome.failure !== undefined);

  return (
    <section
      aria-label="Publish results"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-[15px] font-semibold">
            {published.length} {published.length === 1 ? 'listing' : 'listings'}{' '}
            published
            {refused.length === 0
              ? ''
              : `, ${refused.length} left as ${refused.length === 1 ? 'a draft' : 'drafts'}`}
          </h2>
          {refused.length === 0 ? null : (
            <p className="text-xs text-muted-foreground">
              Each refusal names the fact that is missing. Nothing already live
              was touched.
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          aria-label="Dismiss publish results"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>

      <ul className="flex flex-col">
        {published.map((outcome) => (
          <li
            key={outcome.productId}
            className="flex items-start gap-2.5 border-b border-border px-4 py-3 last:border-b-0"
          >
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-green-600"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{outcome.name}</span>
              <span className="text-xs text-green-700">
                Live now
                {outcome.slug === undefined ? '' : ` at /p/${outcome.slug}`}
                {outcome.offerCount === undefined
                  ? ''
                  : ` with ${outcome.offerCount} offer${outcome.offerCount === 1 ? '' : 's'}`}
                .
              </span>
            </div>
          </li>
        ))}
        {refused.map((outcome) => (
          <li
            key={outcome.productId}
            className="flex items-start gap-2.5 border-b border-border px-4 py-3 last:border-b-0"
          >
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-amber-600"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{outcome.name}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {outcome.failure}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
