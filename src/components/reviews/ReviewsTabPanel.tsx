import ReviewFilterBar from '@/components/reviews/ReviewFilterBar';
import ReviewList from '@/components/reviews/ReviewList';
import ReviewSummaryBand from '@/components/reviews/ReviewSummaryBand';
import { REVIEW_WINDOW_DAYS } from '@/modules/reviews/contracts';
import type {
  SellerReviewFilter,
  SellerReviewRow,
  SellerReviewSummary,
} from '@/modules/reviews/seller-read';

type ReviewsTabPanelProps = {
  summary: SellerReviewSummary;
  rows: SellerReviewRow[];
  total: number;
  filter: SellerReviewFilter;
};

/**
 * The Reviews tab, lifted out of `page.tsx` when the Sold tab joined it.
 *
 * Unchanged behaviour — the policy note, the rating band, the filters and the
 * list, in that order. It lives here so the route file stays composition and
 * data orchestration, which is what the component rules ask of a `page.tsx`.
 */
export default function ReviewsTabPanel({
  summary,
  rows,
  total,
  filter,
}: ReviewsTabPanelProps) {
  const filtered =
    filter.replyState !== null ||
    filter.ratings.length > 0 ||
    filter.query !== '';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2.5 rounded-lg border border-border bg-card p-3.5">
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="mt-px size-4 shrink-0 text-brand-600"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <circle cx="8" cy="8" r="6.2" />
          <path d="M8 7.2v4M8 4.9v.1" />
        </svg>
        <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
          A customer can write a review only after the parcel that carried the
          item is <strong className="font-semibold text-ink">Delivered</strong>,
          and only for {REVIEW_WINDOW_DAYS} days after that. One review for each
          item in the order. You can answer a review one time, and you can
          change your answer later. You cannot delete a customer&rsquo;s review.
        </p>
      </div>

      <ReviewSummaryBand summary={summary} />

      <div className="rounded-lg border border-border bg-card">
        <ReviewFilterBar
          counts={{
            all: summary.count,
            needsReply: summary.needsReply,
            replied: summary.count - summary.needsReply,
          }}
          breakdown={summary.breakdown}
          activeTab={filter.replyState}
          activeStars={filter.ratings}
          query={filter.query}
        />

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 px-6 py-14 text-center">
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="size-8 text-border-strong"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.1"
            >
              <path d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .8 4.3L8 11.4l-3.9 2 .8-4.3-3.1-3 4.3-.6z" />
            </svg>
            <span className="font-display text-base font-semibold text-ink">
              {filtered ? 'No reviews match these filters' : 'No reviews yet'}
            </span>
            <p className="max-w-[46ch] text-[0.8125rem] leading-relaxed text-ink-subtle">
              {filtered
                ? 'Clear a filter to see the rest.'
                : `A customer can write a review after their parcel is marked Delivered. You have ${summary.deliveredLines} delivered ${summary.deliveredLines === 1 ? 'item' : 'items'} that nobody has reviewed. Nothing to do here yet.`}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden gap-4 border-b border-border bg-background px-4 py-2.5 md:grid md:grid-cols-[18.75rem_1fr_12.5rem]">
              <span className="text-xs font-medium text-ink-subtle">
                Item as it was ordered
              </span>
              <span className="text-xs font-medium text-ink-subtle">
                Rating and review
              </span>
              <span className="text-xs font-medium text-ink-subtle">
                Your reply
              </span>
            </div>
            <ReviewList reviews={rows} />
            <p className="px-4 py-3.5 text-xs text-ink-subtle">
              Showing {rows.length} of {total}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
