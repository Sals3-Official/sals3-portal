'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { recheckCandidateNow } from '@/app/(portal)/products/actions';

type RecheckNowButtonProps = {
  candidateId: string;
};

const FAILURE_MESSAGES: Record<
  Exclude<
    Awaited<ReturnType<typeof recheckCandidateNow>>,
    { ok: true }
  >['reason'],
  string
> = {
  invalid_input: 'That candidate id was not in an expected format.',
  denied: 'Your role cannot request a recheck.',
  rate_limited: 'Too many recheck requests. Wait a moment and try again.',
  not_eligible: 'This candidate is not in a retryable state right now.',
  failed: 'The recheck request failed. Try again in a moment.',
};

/**
 * "Recheck now" (spec: debugging/admin use only, retryable rows only). Only
 * nudges the automated pipeline to retry sooner - it never fetches CJ
 * evidence itself and never appears for a permanent `BLOCKED` decision.
 */
export default function RecheckNowButton({
  candidateId,
}: RecheckNowButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await recheckCandidateNow(candidateId);

          if (result.ok) {
            toast('Queued for recheck.');
          } else {
            toast(FAILURE_MESSAGES[result.reason]);
          }
        });
      }}
    >
      {isPending ? 'Requesting…' : 'Recheck now'}
    </Button>
  );
}
