import type { SellerReviewSummary } from '@/modules/reviews/seller-read';
import StarRating from './StarRating';

/**
 * The rating band: one average, the shape behind it, and the three numbers a
 * seller can act on.
 *
 * ## Why a distribution and not four tiles
 *
 * An average alone cannot tell "mostly five stars with two angry outliers" from
 * "everything is a three", and those need different work. Four unrelated
 * headline numbers — the shape the marketplace screenshot this was modelled on
 * uses — states neither.
 *
 * ## Why there is no "good rating rate"
 *
 * A percentage of four-and-five-star reviews reads as a score to chase, and
 * ADR-010 keeps ratings out of anything that gates. What replaces it is the
 * share of delivered items reviewed at all, labelled as not a target — that one
 * is about coverage, not quality, and it cannot be gamed by pressuring buyers.
 *
 * CSS bar meters, per the design system's own note: no chart library ships for
 * five bars.
 */
export default function ReviewSummaryBand({
  summary,
}: {
  summary: SellerReviewSummary;
}) {
  const reviewedShare =
    summary.deliveredLines === 0
      ? null
      : Math.round((summary.count / summary.deliveredLines) * 100);

  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-border bg-card md:grid-cols-[14.5rem_1fr]">
      <div className="flex flex-col gap-2 border-border bg-background p-5 md:border-r">
        <span className="text-xs font-medium text-ink-subtle">
          Average rating
        </span>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-[2.5rem] leading-none font-semibold text-ink tabular-nums">
            {summary.count === 0 ? '—' : summary.average.toFixed(1)}
          </span>
          <span className="text-[0.9375rem] font-medium text-ink-faint">
            / 5
          </span>
        </div>
        <StarRating
          rating={Math.round(summary.average)}
          size="lg"
          label={
            summary.count === 0
              ? 'No rating yet'
              : `${summary.average.toFixed(1)} out of 5`
          }
        />
        <span className="text-xs leading-normal text-ink-subtle">
          {summary.count === 0
            ? 'Nobody has reviewed your items yet.'
            : `From ${summary.count} ${summary.count === 1 ? 'review' : 'reviews'}.`}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_18.75rem]">
        <div className="flex flex-col gap-1.5 border-border p-5 lg:border-r">
          {[5, 4, 3, 2, 1].map((star) => {
            const total = summary.breakdown[star - 1] ?? 0;
            const share =
              summary.count === 0
                ? 0
                : Math.round((total / summary.count) * 100);

            return (
              <div key={star} className="flex items-center gap-2.5">
                <span className="flex w-10 shrink-0 items-center gap-1 text-xs font-medium text-ink-muted">
                  {star}
                  <StarRating rating={1} size="sm" label="" />
                </span>
                <div className="h-2 flex-grow overflow-hidden rounded-full bg-muted">
                  <div
                    // A 1-2 star bar is tinted `destructive` so the shape of a
                    // problem is visible without reading the numbers. The count
                    // and share beside it carry the same fact in words, so
                    // colour is never the only signal.
                    className={`h-2 rounded-full ${star <= 2 ? 'bg-destructive' : 'bg-amber-600'}`}
                    style={{ width: `${share}%` }}
                  />
                </div>
                <span className="w-9 shrink-0 text-right text-xs font-medium text-ink-muted tabular-nums">
                  {total}
                </span>
                <span className="w-10 shrink-0 text-right text-xs text-ink-faint tabular-nums">
                  {summary.count === 0 ? '—' : `${share}%`}
                </span>
              </div>
            );
          })}
        </div>

        <dl className="flex flex-col">
          <div className="flex items-center gap-3 border-b border-border px-5 py-3">
            <dt className="inline-flex h-[1.375rem] items-center rounded border border-warning-border bg-warning-surface px-2 text-[0.6875rem] font-semibold text-amber-700">
              Needs reply
            </dt>
            <dd className="ml-auto font-display text-xl font-semibold text-ink tabular-nums">
              {summary.needsReply}
            </dd>
          </div>
          <div className="flex items-center gap-3 border-b border-border px-5 py-3">
            <dt className="inline-flex h-[1.375rem] items-center rounded border border-danger-border bg-danger-surface px-2 text-[0.6875rem] font-semibold text-red-700">
              1 or 2 stars, no reply
            </dt>
            <dd className="ml-auto font-display text-xl font-semibold text-red-700 tabular-nums">
              {summary.lowUnanswered}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 px-5 py-3">
            <div className="flex items-center gap-3">
              <dt className="text-xs font-medium text-ink-muted">
                Delivered items reviewed
              </dt>
              <dd className="ml-auto font-display text-xl font-semibold text-ink tabular-nums">
                {reviewedShare === null ? '—' : `${reviewedShare}%`}
              </dd>
            </div>
            <p className="text-[0.6875rem] leading-snug text-ink-faint">
              {reviewedShare === null
                ? 'No delivered items yet.'
                : `${summary.count} of ${summary.deliveredLines} delivered items. Not a target.`}
            </p>
          </div>
        </dl>
      </div>
    </div>
  );
}
