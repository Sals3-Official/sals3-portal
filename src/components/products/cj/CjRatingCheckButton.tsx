'use client';

import { Loader2, RotateCw, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { checkCjRatingAction } from '@/app/(portal)/products/actions';
import type { ReviewEvidence } from '@/lib/cj/evidence';

type CjRatingCheckButtonProps = {
  externalProductId: string;
  /**
   * This row's place in the page, used to space out auto-checks so 20 rows
   * don't all hit CJ at once (one request per second per connection, and
   * one check already costs three calls). Each row waits
   * `index * STAGGER_MS` before starting on its own.
   */
  index: number;
};

const STAGGER_MS = 2_500;

const FAILURE_MESSAGE: Record<string, string> = {
  'no-connection': 'No CJ connection to check against.',
  'rate-limited': 'CJ rate-limited this request.',
  'authentication-failed': 'The CJ connection needs to be reconnected.',
  'upstream-unavailable': 'CJ did not respond.',
  'unexpected-response': 'CJ returned something this portal could not read.',
  'invalid-input': 'Could not check this product.',
};

type State =
  | { status: 'waiting' }
  | { status: 'checking' }
  | { status: 'done'; reviews: ReviewEvidence }
  | { status: 'error'; message: string };

/**
 * Automatic, self-staggered CJ rating check for a "Not yet queued" row - the
 * automated pipeline has not fetched review evidence for it yet, so there is
 * nothing to show until something asks. Runs on its own shortly after the
 * row mounts (no click needed - a seller scanning the raw feed wants this as
 * a guard rail before deciding what to list, not as an extra chore). Still
 * only ever one real CJ call per row, never repeated unless the seller hits
 * retry after a failure.
 *
 * Labelled "CJ reviews" throughout - this is supplier-platform evidence,
 * never a Sals3 buyer rating.
 */
export default function CjRatingCheckButton({
  externalProductId,
  index,
}: CjRatingCheckButtonProps) {
  const [state, setState] = useState<State>({ status: 'waiting' });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const timer = setTimeout(
      () => {
        if (cancelled) return;
        setState({ status: 'checking' });

        checkCjRatingAction({ externalProductId })
          .then((result) => {
            if (cancelled) return;

            if (result.ok) {
              setState({ status: 'done', reviews: result.reviews });
              return;
            }

            setState({
              status: 'error',
              message: FAILURE_MESSAGE[result.reason] ?? 'Check failed.',
            });
          })
          .catch(() => {
            if (!cancelled) {
              setState({ status: 'error', message: 'Check failed.' });
            }
          });
      },
      Math.min(index, 19) * STAGGER_MS,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [externalProductId, index, retryKey]);

  if (state.status === 'waiting' || state.status === 'checking') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
        {state.status === 'checking' ? 'Checking CJ reviews…' : 'Queued'}
      </span>
    );
  }

  if (state.status === 'error') {
    return (
      <button
        type="button"
        title={state.message}
        onClick={() => {
          setRetryKey((key) => key + 1);
          setState({ status: 'waiting' });
        }}
        className="inline-flex items-center gap-1 text-xs text-red-600 underline decoration-dotted decoration-from-font underline-offset-2 hover:decoration-solid"
      >
        <RotateCw aria-hidden="true" className="size-3" />
        Retry rating check
      </button>
    );
  }

  return state.reviews.sampledAverageScore === null ? (
    <span className="text-xs text-muted-foreground">No CJ reviews yet</span>
  ) : (
    <span
      title="CJ supplier-platform reviews, not a Sals3 buyer rating"
      className="inline-flex items-center gap-0.5 text-xs text-amber-600"
    >
      <Star aria-hidden="true" className="size-3 fill-current" />
      {state.reviews.sampledAverageScore.toFixed(1)} ({state.reviews.totalCount}
      )
    </span>
  );
}
