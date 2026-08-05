import { Star } from 'lucide-react';
import type { ProductReview } from '@/lib/products/types';

type ReviewsPanelProps = {
  reviews: ProductReview[];
  canReply: boolean;
  canModerate: boolean;
};

/**
 * Customer reviews. Reply and report are rendered only for roles that hold the
 * permission; the server actions for both are not built yet, so the controls are
 * marked as not available instead of pretending to work.
 */
export default function ReviewsPanel({
  reviews,
  canReply,
  canModerate,
}: ReviewsPanelProps) {
  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This product has no reviews yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {reviews.map((review) => (
        <li
          key={review.id}
          className="rounded-lg border border-border p-3 text-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{review.author}</p>
            <p
              className="flex items-center gap-0.5"
              aria-label={`${review.rating} out of 5 stars`}
            >
              {Array.from({ length: 5 }, (_, index) => (
                <Star
                  key={index}
                  aria-hidden="true"
                  className={`size-3.5 ${
                    index < review.rating
                      ? 'fill-amber-600 text-amber-600'
                      : 'text-ink-faint'
                  }`}
                />
              ))}
            </p>
            <p className="text-xs text-muted-foreground">{review.createdAt}</p>
            {review.reported ? (
              <span className="rounded bg-danger-surface px-1.5 py-0.5 text-xs font-medium text-red-600">
                Reported
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-ink-muted">{review.body}</p>
          {review.reply === null ? null : (
            <p className="mt-2 border-l-2 border-border pl-3 text-ink-muted">
              <span className="font-medium">Seller reply: </span>
              {review.reply}
            </p>
          )}
          {canReply || canModerate ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {review.reply === null && canReply ? 'Reply' : null}
              {review.reply === null && canReply && canModerate ? ' · ' : null}
              {canModerate ? 'Report' : null}
              {' is not available yet. The review service is not built.'}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
