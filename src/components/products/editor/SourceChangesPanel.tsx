import { Lock, Store } from 'lucide-react';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { formatDateTime } from '@/lib/seller-center/product-editor/format';
import type { SourceChangeFixture } from '@/lib/seller-center/product-editor/types';

type SourceChangesPanelProps = {
  changes: SourceChangeFixture[];
};

/**
 * Supplier-side changes recorded since this candidate was first evaluated.
 *
 * The load-bearing part is that each entry states *two* impacts, never
 * one: what happens to the current listing, and what happens to orders
 * that were already accepted. Those are different things (ADR-007) - a
 * listing may be updated, warned, paused or delisted, while an accepted
 * order keeps the product representation, variant, price basis, image
 * reference and supplier evidence it was accepted with. Collapsing them
 * into a single "this product changed" line is what would make a seller
 * believe their order history had been rewritten.
 */
export default function SourceChangesPanel({
  changes,
}: SourceChangesPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-ink-muted">
        Supplier-side changes recorded since this candidate was first evaluated.
        A change can affect the current listing. It never rewrites an accepted
        order.
      </p>

      {changes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong p-4 text-center text-xs text-muted-foreground">
          No supplier changes recorded for this product.
        </p>
      ) : (
        <ul className="flex list-none flex-col gap-2.5 p-0">
          {changes.map((change) => (
            <li
              key={change.id}
              className={`rounded-lg border border-border border-l-[3px] bg-card p-2.5 ${
                change.listingAutoPaused
                  ? 'border-l-red-600'
                  : 'border-l-amber-600'
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h5 className="text-[13px] font-semibold">{change.title}</h5>
                <span className="text-[11px] text-muted-foreground">
                  {formatDateTime(change.occurredAt)}
                </span>
              </div>
              <p className="mt-1 mb-2 text-xs text-ink-muted">{change.body}</p>

              <div className="flex items-start gap-1.5 text-xs leading-relaxed text-ink-muted">
                <Store
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-primary"
                />
                <span>{change.currentListingImpact}</span>
              </div>
              <div className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-ink-muted">
                <Lock
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-teal-500"
                />
                <span>{change.acceptedOrderImpact}</span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusPill
                  label={
                    change.listingAutoPaused
                      ? 'Listing auto-paused'
                      : 'Listing not paused'
                  }
                  tone={change.listingAutoPaused ? 'danger' : 'neutral'}
                />
                <StatusPill
                  label={
                    change.sellerActionRequired
                      ? 'Seller action required'
                      : 'No action required'
                  }
                  tone={change.sellerActionRequired ? 'warning' : 'neutral'}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
