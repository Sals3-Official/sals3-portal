'use client';

import { useRouter } from 'next/navigation';
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
 * ## The row leaves after the server confirms, not before — but not after a
 * second server read either
 *
 * `decide()` calls `onDecided()` only once `moderateReviewAction` has returned
 * `ok: true` — never before the request resolves, and never on a refusal. That
 * is not the same thing as trusting the click: a moderation queue that visibly
 * empties before the server has agreed and quietly fails is the one kind of
 * list where a stale-looking screen would be safer than a wrong-looking one, a
 * review the moderator believes they hid, still live, being exactly the
 * failure the report was raised about.
 *
 * What it does skip is waiting for a *second*, separate server read to
 * corroborate what the first response already said. `ReportedReviewsList`'s own
 * note explains why that wait cannot be assumed to finish before the moderator
 * looks back at the row — `router.refresh()` below still runs, to reconcile
 * this tab against another moderator's own decision on the same review.
 */
export default function ModerationDecisionButtons({
  reviewId,
  onDecided,
}: {
  reviewId: string;
  /**
   * Called the instant the server confirms the decision, so the row leaves
   * the queue on this moderator's own screen without waiting on a second,
   * separate read to say the same thing — see `ReportedReviewsList`'s note.
   * `router.refresh()` still follows, to keep this tab honest against another
   * moderator's own decision on the same review.
   */
  onDecided: () => void;
}) {
  const router = useRouter();
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

      setArmed(false);
      onDecided();
      router.refresh();
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
