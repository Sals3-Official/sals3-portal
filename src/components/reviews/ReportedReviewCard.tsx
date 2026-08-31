import Image from 'next/image';
import { REVIEW_FLAG_REASON_COPY } from '@/modules/reviews/contracts';
import type { ReportedReview } from '@/modules/reviews/moderation';
import ModerationDecisionButtons from './ModerationDecisionButtons';
import StarRating from './StarRating';

const DATE_FORMAT = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * One reported review, with everything a decision needs and nothing else.
 *
 * ## What is deliberately absent
 *
 * **Who reported it.** `reporter_email` is authorisation data — it exists so
 * the unique index can stop one person filing a hundred reports, not so anybody
 * can read a list of complainants. A moderator deciding whether a review breaks
 * a rule does not need it, and `readOpenReasonsFor` never selects it.
 *
 * **The seller.** A queue that names the account whose listing is being
 * complained about invites the decision to be made about the seller rather than
 * about the words. The product title is here because the review has to be read
 * in context; the shop behind it is not the question.
 *
 * ## The reasons are a tally, not a verdict
 *
 * Two people calling something offensive is two people's opinion, and it is
 * shown as a count for that reason. Nothing on this card sorts, colours or
 * escalates by volume — the queue is ordered oldest-first precisely so a
 * coordinated group cannot jump the line.
 */
export default function ReportedReviewCard({
  review,
  photos,
  onDecided,
}: {
  review: ReportedReview;
  photos: { url: string; width: number; height: number }[];
  /** Forwarded to `ModerationDecisionButtons` — see its own note. */
  onDecided: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 md:flex-row">
      <div className="flex min-w-0 flex-grow flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex h-[1.375rem] items-center rounded border border-danger-border bg-danger-surface px-2 text-[0.6875rem] font-semibold text-red-700">
            {review.reportCount}{' '}
            {review.reportCount === 1 ? 'report' : 'reports'}
          </span>
          <span className="text-[0.8125rem] font-semibold text-ink">
            {review.productTitle}
          </span>
          <span className="text-xs text-ink-faint">
            First reported{' '}
            {DATE_FORMAT.format(new Date(review.firstReportedAt))}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <StarRating
            rating={review.rating}
            label={`${review.rating} out of 5`}
          />
          {review.deliveryRating === null ? null : (
            <span className="text-xs text-ink-subtle">
              Delivery{' '}
              <span className="font-semibold text-ink tabular-nums">
                {review.deliveryRating} / 5
              </span>
            </span>
          )}
          <span className="text-xs text-ink-faint">
            {review.displayName ?? 'A Sals3 customer'} ·{' '}
            {DATE_FORMAT.format(new Date(review.createdAt))}
          </span>
        </div>

        <p className="max-w-[70ch] text-[0.8125rem] leading-relaxed text-ink">
          {review.body ?? (
            <span className="text-ink-faint italic">
              Rating only — this buyer wrote nothing.
            </span>
          )}
        </p>

        {/*
          The photos are rendered, not counted. A report about an image cannot
          be decided from the number 3, and asking a moderator to open the
          storefront to see what they are ruling on is how a queue stops being
          used.
        */}
        {photos.length === 0 ? null : (
          <div className="flex flex-wrap gap-2">
            {photos.map((photo) => (
              <span
                key={photo.url}
                className="relative size-20 overflow-hidden rounded-md border border-border bg-muted"
              >
                <Image
                  src={photo.url}
                  alt=""
                  width={80}
                  height={80}
                  sizes="80px"
                  className="size-full object-cover"
                />
              </span>
            ))}
          </div>
        )}

        <p className="text-xs leading-relaxed text-ink-subtle">
          Reported as{' '}
          {review.reasons.map((entry, index) => (
            <span key={entry.reason}>
              {index === 0 ? '' : ', '}
              <span className="font-semibold text-ink-muted">
                {REVIEW_FLAG_REASON_COPY[entry.reason]}
              </span>
              {entry.count === 1 ? '' : ` (${entry.count})`}
            </span>
          ))}
          .
        </p>
      </div>

      <div className="shrink-0 md:w-44">
        <ModerationDecisionButtons
          reviewId={review.reviewId}
          onDecided={onDecided}
        />
      </div>
    </div>
  );
}
