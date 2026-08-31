'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SellerReviewRow } from '@/modules/reviews/seller-read';
import ReviewReplyDialog, { type SavedReply } from './ReviewReplyDialog';
import ReviewRow from './ReviewRow';

/**
 * The list, and the only client state on this screen: which review is open in
 * the reply dialog, and a reply the seller just saved that has not yet arrived
 * back through a server prop.
 *
 * Filtering, paging and search are all URL-driven and resolved on the server —
 * see `review-params.ts`. This component deliberately owns nothing else, so the
 * rows stay plain rendering and a filter change is a navigation rather than a
 * re-filter of data the browser already holds.
 *
 * ## The local reply overlay, and why `router.refresh()` alone was not enough
 *
 * Reported from production 2026-08-31: a seller replied, the dialog closed,
 * and the row still read "No reply yet" until a manual page reload —
 * `router.refresh()` asks Next to re-fetch this page's server data, but
 * nothing here can promise *when* that finishes, and the row a seller looks
 * back at is exactly the moment it has not.
 *
 * `replyToReviewAction` already tells us the write succeeded and hands back
 * the exact version it wrote, so there is no reason the seller's own screen
 * should wait on a second round trip to say the same thing. `localReplies`
 * shows that answer immediately, keyed by review id.
 *
 * It is reconciled by **version**, not held forever: once `reviews` itself
 * carries a reply at this version or later, the override is dropped in favour
 * of the real prop. That is the same "compare during render, adjust" shape
 * `ProductCatalogueWorkspace` uses for its own case of a server write
 * outliving state seeded from a since-stale prop — React's own documented
 * pattern for this, not an effect, so there is no extra commit and no flash of
 * the old row.
 *
 * `router.refresh()` still runs after a successful save. The overlay is what
 * the seller sees now; the refresh is what keeps this tab honest against a
 * second tab, a different session, or the server's own timestamp once it
 * arrives.
 */
export default function ReviewList({
  reviews,
}: {
  reviews: SellerReviewRow[];
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [localReplies, setLocalReplies] = useState<Record<string, SavedReply>>(
    {},
  );
  const [lastReviews, setLastReviews] = useState(reviews);

  if (lastReviews !== reviews) {
    setLastReviews(reviews);
    setLocalReplies((current) => {
      let changed = false;
      const next = { ...current };

      reviews.forEach((review) => {
        const local = next[review.id];

        if (
          local !== undefined &&
          review.reply !== null &&
          review.reply.version >= local.version
        ) {
          delete next[review.id];
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }

  const displayed = reviews.map((review) => {
    const local = localReplies[review.id];

    return local === undefined ? review : { ...review, reply: local };
  });

  const open = displayed.find((review) => review.id === openId) ?? null;

  return (
    <>
      <div>
        {displayed.map((review) => (
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
          onClose={(saved, reply) => {
            setOpenId(null);

            if (!saved || reply === undefined) return;

            setLocalReplies((current) => ({
              ...current,
              [open.id]: reply,
            }));
            router.refresh();
          }}
        />
      )}
    </>
  );
}
