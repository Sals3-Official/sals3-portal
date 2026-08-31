import Image from 'next/image';
import type { SellerReviewRow } from '@/modules/reviews/seller-read';
import StarRating from './StarRating';

const DATE_FORMAT = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * One review row.
 *
 * The product name, variant and photo come from the **order line**, not the
 * live listing: a seller who has since renamed or re-photographed the product
 * still sees the review against what the buyer actually received (ADR-007), and
 * that is the only version a reply can sensibly answer.
 *
 * `onReply` is passed in rather than the dialog living here, so this stays a
 * server-rendered row and only the workspace above it is a client component.
 */
export default function ReviewRow({
  review,
  replyButton,
}: {
  review: SellerReviewRow;
  /** Rendered in the action column. A client control, injected. */
  replyButton: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 border-b border-border p-4 md:grid-cols-[18.75rem_1fr_12.5rem]">
      <div className="flex min-w-0 gap-2.5">
        <span className="relative flex size-13 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
          {review.imageUrl === null ? null : (
            // The address frozen onto the order line, not the live listing's —
            // the buyer reviewed the photo they were shown. `next/image` with
            // the project's custom loader, matching `CatalogueProductRow`: the
            // metered optimizer is bypassed, so this costs nothing per render.
            <Image
              src={review.imageUrl}
              alt=""
              width={52}
              height={52}
              sizes="52px"
              className="size-full object-cover"
            />
          )}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[0.8125rem] leading-snug font-semibold text-ink">
            {review.productTitle}
          </span>
          <span className="text-xs leading-snug text-ink-subtle">
            {review.variantLabel ?? 'No variant recorded'}
          </span>
          <span className="text-[0.6875rem] text-ink-faint">
            Order {review.orderNumber}
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <StarRating
            rating={review.rating}
            label={`${review.rating} out of 5`}
          />
          <span className="text-xs font-semibold text-ink tabular-nums">
            {review.rating.toFixed(1)}
          </span>
          <span className="text-xs text-ink-faint">
            {review.displayName ?? 'A Sals3 customer'} ·{' '}
            {DATE_FORMAT.format(new Date(review.createdAt))}
          </span>
        </div>
        {/*
          Delivery beside the product score, never folded into it. A buyer who
          waited three weeks for a good item scores the delivery low and the
          product high, and this row is where a seller learns their shipping
          tier is wrong rather than their listing.

          Both are absent rather than rendered empty when there is nothing to
          say. A dash in a column of numbers still reads as a score of some
          kind, and "0 photos" is a line of type that earns nothing.
        */}
        {review.deliveryRating === null && review.photoCount === 0 ? null : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {review.deliveryRating === null ? null : (
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-subtle">
                Delivery
                <span className="font-semibold text-ink tabular-nums">
                  {review.deliveryRating} / 5
                </span>
              </span>
            )}
            {review.photoCount === 0 ? null : (
              <span className="text-xs text-ink-subtle">
                <span className="font-semibold text-ink tabular-nums">
                  {review.photoCount}
                </span>{' '}
                {review.photoCount === 1 ? 'photo' : 'photos'}
              </span>
            )}
          </div>
        )}
        <p className="max-w-[62ch] text-[0.8125rem] leading-relaxed text-ink-muted">
          {review.body ?? (
            <span className="text-ink-faint italic">
              Rating only — this buyer wrote nothing.
            </span>
          )}
        </p>
        {review.reply !== null ? (
          <p className="mt-1 max-w-[62ch] border-l-2 border-border pl-2.5 text-xs leading-relaxed text-ink-subtle">
            <span className="font-semibold text-ink-muted">You replied: </span>
            {review.reply.body}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col items-start gap-2">
        {review.reply === null ? (
          <span className="inline-flex h-[1.375rem] items-center rounded border border-warning-border bg-warning-surface px-2 text-[0.6875rem] font-semibold text-amber-700">
            No reply yet
          </span>
        ) : (
          <span className="inline-flex h-[1.375rem] items-center rounded bg-success-surface px-2 text-[0.6875rem] font-semibold text-green-700">
            Replied {DATE_FORMAT.format(new Date(review.reply.createdAt))}
          </span>
        )}
        {replyButton}
      </div>
    </div>
  );
}
