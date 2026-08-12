import Link from 'next/link';

type SiblingParcelCardProps = {
  orderRef: string;
  siblings: { id: string; indexLabel: string; routeLabel: string }[];
};

/**
 * The other parcels under the same order reference.
 *
 * Rendered only on a split order. It exists because the money cards on this
 * page are deliberately parcel-scoped while the buyer payment is not - a
 * seller looking at one leg of a split needs somewhere obvious to find the
 * other, and a reminder that each leg settles on its own.
 */
export default function SiblingParcelCard({
  orderRef,
  siblings,
}: SiblingParcelCardProps) {
  if (siblings.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-[15px] font-semibold">
          Other parcels on {orderRef}
        </h2>
        <span className="text-[12px] text-ink-faint">
          Each parcel ships and settles on its own.
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {siblings.map((sibling) => (
          <Link
            key={sibling.id}
            href={`/orders/${sibling.id}`}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-[12.5px] transition-colors hover:border-primary"
          >
            <span className="font-medium text-ink">{sibling.indexLabel}</span>
            <span className="text-ink-subtle">{sibling.routeLabel}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
