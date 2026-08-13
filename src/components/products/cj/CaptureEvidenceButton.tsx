'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  captureCandidateEvidenceAction,
  type CaptureEvidenceActionResult,
} from '@/app/(portal)/products/evidence-actions';

type CaptureEvidenceButtonProps = {
  candidateId: string;
  /** Changes the label only: the action is the same upsert either way. */
  hasSnapshot: boolean;
};

type FailureReason = Extract<
  CaptureEvidenceActionResult,
  { ok: false }
>['reason'];

const FAILURE_MESSAGES: Record<FailureReason, string> = {
  invalid_input: 'That candidate id was not in an expected format.',
  denied: 'Your role cannot fetch supplier evidence.',
  rate_limited: 'Too many evidence fetches. Wait a moment and try again.',
  not_configured: 'No database is configured in this environment.',
  failed: 'The evidence fetch failed. Try again in a moment.',
};

const ITEM_FAILURE_MESSAGES: Record<string, string> = {
  not_found: 'That candidate is no longer in your pipeline.',
  connection_unhealthy:
    'Your CJ connection needs attention before evidence can be fetched.',
  supplier_unavailable: 'CJ did not answer. Nothing was saved.',
  rate_limited: 'CJ is rate-limiting this account right now.',
};

/**
 * Fetches this candidate's CJ detail evidence — the variants, per-variant
 * costs, per-warehouse inventory, and image URLs a product draft needs.
 *
 * Deliberately a button and not automatic. One press is three CJ requests
 * against an exhaustible daily points budget reserved for checkout and
 * accepted-order protection (ADR-013 §5), so spending it is an operator
 * decision with an audit row, not a side effect of opening a drawer.
 */
export default function CaptureEvidenceButton({
  candidateId,
  hasSnapshot,
}: CaptureEvidenceButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-fit"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await captureCandidateEvidenceAction({
            candidateIds: [candidateId],
          });

          if (!result.ok) {
            toast(FAILURE_MESSAGES[result.reason]);
            return;
          }

          const failure = result.failed[0];

          if (failure !== undefined) {
            toast(
              ITEM_FAILURE_MESSAGES[failure.reason] ??
                'The evidence fetch failed. Try again in a moment.',
            );
            return;
          }

          toast('Supplier evidence captured.');
        });
      }}
    >
      {/* eslint-disable-next-line no-nested-ternary -- three states, one label. */}
      {isPending
        ? 'Fetching from CJ…'
        : hasSnapshot
          ? 'Refresh supplier evidence'
          : 'Fetch supplier evidence'}
    </Button>
  );
}
