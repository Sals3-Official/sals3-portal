'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SellerReviewRow } from '@/modules/reviews/seller-read';
import ReviewReplyDialog from './ReviewReplyDialog';
import ReviewRow from './ReviewRow';

/**
 * The list, and the only client state on this screen: which review is open in
 * the reply dialog.
 *
 * Filtering, paging and search are all URL-driven and resolved on the server —
 * see `review-params.ts`. This component deliberately owns nothing else, so the
 * rows stay plain rendering and a filter change is a navigation rather than a
 * re-filter of data the browser already holds.
 *
 * After a successful reply it calls `router.refresh()`, which re-runs the
 * server component with the same search params. Not `push`: the seller's filter
 * and page must survive answering a review, and a push would also add a history
 * entry for something that was not a navigation.
 */
export default function ReviewList({
  reviews,
}: {
  reviews: SellerReviewRow[];
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);

  const open = reviews.find((review) => review.id === openId) ?? null;

  return (
    <>
      <div>
        {reviews.map((review) => (
          <ReviewRow
            key={review.id}
            review={review}
            replyButton={
              <button
                type="button"
                onClick={() => setOpenId(review.id)}
                className={
                  review.reply === null
                    ? 'h-[1.875rem] cursor-pointer rounded-md bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition-colors duration-150 hover:bg-brand-700'
                    : 'h-[1.875rem] cursor-pointer rounded-md border border-input bg-card px-3 text-xs font-medium text-ink-muted transition-colors duration-150 hover:bg-accent'
                }
              >
                {review.reply === null ? 'Reply' : 'Change reply'}
              </button>
            }
          />
        ))}
      </div>

      {open === null ? null : (
        <ReviewReplyDialog
          review={open}
          onClose={(saved) => {
            setOpenId(null);

            if (saved) router.refresh();
          }}
        />
      )}
    </>
  );
}
