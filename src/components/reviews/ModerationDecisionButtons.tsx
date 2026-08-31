'use client';

import { useState, useTransition } from 'react';
import moderateReviewAction from '@/app/(portal)/reviews/reported/moderation-actions';

/**
 * Hide or keep, on one reported review.
 *
 * ## Why hiding asks twice and keeping does not
 *
 * Hiding withdraws a customer's published words, and there is no undo on this
 * screen — a moderator who meant to press Keep and hit Hide has removed
 * evidence a buyer wrote. Keeping changes nothing anybody can see; it closes
 * the reports and records that somebody looked, which is a decision worth
 * making cheap.
 *
 * The confirmation is a second press of the same button rather than a dialog:
 * a modal here would be one more thing to build and dismiss on a queue that is
 * mostly Keep, and an inline "Press again to hide" says the same thing without
 * moving focus out of the row.
 *
 * ## No optimistic update
 *
 * The row leaves the queue only after the server says the reports are closed.
 * A moderation queue that visibly empties on click and quietly fails is the one
 * kind of list where a stale-looking screen is safer than a wrong-looking one —
 * a review the moderator believes they hid, still live, is exactly the failure
 * the report was raised about.
 */
export default function ModerationDecisionButtons({
  reviewId,
}: {
  reviewId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function decide(decision: 'hide' | 'keep') {
    setError(null);
    startTransition(async () => {
      const result = await moderateReviewAction({ reviewId, decision });

      if (!result.ok) {
        setError(result.message);
        setArmed(false);

        return;
      }

      // No local state change on success: `revalidatePath` re-renders the queue
      // without this row, which is the same source of truth the next moderator
      // will load. Clearing it here as well would be a second answer able to
      // disagree with the first.
      setArmed(false);
    });
  }

  return (
    <div className="flex flex-col items-stretch gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => (armed ? decide('hide') : setArmed(true))}
        onBlur={() => setArmed(false)}
        className="inline-flex h-8 items-center justify-center rounded-md border border-danger-border bg-danger-surface px-3 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {armed ? 'Press again to hide' : 'Hide from storefront'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => decide('keep')}
        className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-card px-3 text-xs font-semibold text-ink transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        Keep published
      </button>
      {error === null ? null : (
        <p role="alert" className="text-[0.6875rem] leading-snug text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
