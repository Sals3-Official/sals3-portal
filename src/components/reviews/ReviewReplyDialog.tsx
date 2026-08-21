'use client';

import { useState, useTransition } from 'react';
import replyToReviewAction from '@/app/(portal)/reviews/reply-actions';
import { REVIEW_REPLY_MAX_LENGTH } from '@/modules/reviews/contracts';
import type { SellerReviewRow } from '@/modules/reviews/seller-read';
import StarRating from './StarRating';

/**
 * The reply editor, as a modal over the list.
 *
 * A dialog rather than an inline row expansion, following the Market Rules
 * pop-out: an inline editor shoves every row below it down the page while the
 * seller is reading the review above it, which is the defect that rework fixed.
 *
 * ## The two things it refuses to imply
 *
 * A reply does not change the rating and does not hide the review. Sellers ask
 * for both, so the panel says so rather than leaving them to discover it. The
 * `review:moderate` path that *can* withhold a review is the Admin Portal's
 * (ADR-014) and is deliberately not a control here.
 */
export default function ReviewReplyDialog({
  review,
  onClose,
}: {
  review: SellerReviewRow;
  onClose: (saved: boolean) => void;
}) {
  const [body, setBody] = useState(review.reply?.body ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmed = body.trim();
  const tooLong = trimmed.length > REVIEW_REPLY_MAX_LENGTH;
  const canSave = trimmed !== '' && !tooLong && !pending;

  function save() {
    setError(null);

    startTransition(async () => {
      const result = await replyToReviewAction({
        reviewId: review.id,
        body: trimmed,
        // The version this dialog rendered. Compare-and-set: a second tab that
        // answered first makes this a stated conflict rather than a silent
        // overwrite.
        expectedReplyVersion: review.reply?.version ?? null,
      });

      if (result.ok) {
        onClose(true);

        return;
      }

      setError(result.message);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reply-heading"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-brand-900/30 p-6 backdrop-blur-[2px]"
    >
      <div className="w-full max-w-[45rem] overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-start gap-3 border-b border-border p-5">
          <div className="flex flex-col gap-0.5">
            <h2
              id="reply-heading"
              className="font-display text-[1.0625rem] font-semibold text-ink"
            >
              {review.reply === null
                ? 'Reply to this review'
                : 'Change your reply'}
            </h2>
            <p className="text-xs text-ink-subtle">
              Your reply shows under the review on the product page, with your
              shop name.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => onClose(false)}
            className="ml-auto flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors duration-150 hover:bg-accent"
          >
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
              />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-background p-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[0.8125rem] font-semibold text-ink">
                {review.productTitle}
              </span>
              <span className="text-xs text-ink-subtle">
                {review.variantLabel ?? 'No variant recorded'} · Order{' '}
                {review.orderNumber}
              </span>
            </div>
            <StarRating
              rating={review.rating}
              label={`${review.rating} out of 5`}
            />
            <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
              {review.body ?? 'This buyer left a rating and no written review.'}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="flex flex-col gap-1.5" htmlFor="reply-body">
              <span className="text-[0.8125rem] font-semibold text-ink">
                Your reply
              </span>
              <textarea
                id="reply-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={5}
                className="rounded-lg border border-input bg-card p-3 text-[0.8125rem] leading-relaxed text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="flex items-baseline gap-2.5">
              <span className="text-xs leading-normal text-ink-subtle">
                Write a reply a customer can act on. Do not put an email
                address, a phone number, or a discount code here.
              </span>
              <span
                className={`ml-auto shrink-0 text-xs tabular-nums ${tooLong ? 'font-semibold text-red-700' : 'text-ink-faint'}`}
              >
                {trimmed.length} / {REVIEW_REPLY_MAX_LENGTH}
              </span>
            </div>
          </div>

          <p className="rounded-lg border border-warning-border bg-warning-surface p-3 text-xs leading-relaxed text-amber-700">
            A reply does not change the star rating and does not hide the
            review. If the review breaks the rules, report it instead. Sals3
            staff decide, not you.
          </p>

          {error !== null ? (
            <p
              role="alert"
              className="text-[0.8125rem] font-medium text-red-700"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-background p-3.5">
          <button
            type="button"
            onClick={() => onClose(false)}
            className="h-9 cursor-pointer rounded-md border border-input bg-card px-3.5 text-[0.8125rem] font-medium text-ink-muted transition-colors duration-150 hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={save}
            className="h-9 cursor-pointer rounded-md bg-primary px-4.5 text-[0.8125rem] font-semibold text-primary-foreground transition-colors duration-150 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Post reply'}
          </button>
        </div>
      </div>
    </div>
  );
}
