'use client';

import { useState } from 'react';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import type { CandidateEvidence } from '@/lib/cj/evidence';
import type { CandidateEvaluationRow } from '@/lib/db/schema';
import presentEvaluationStatus from './evaluation-status';
import EvaluationDrawer from './EvaluationDrawer';

type EvaluationStatusBadgeProps = {
  productName: string;
  evaluation: CandidateEvaluationRow | null;
  evidence: CandidateEvidence | null;
};

/**
 * Read-only status badge (spec's UI corrections: "the system performs the
 * evaluation, not the seller"). Replaces the old per-row "Check for Sals3"
 * button - there is no action to trigger here, only a detail drawer opened
 * on click. The smallest possible `'use client'` boundary, matching the
 * pattern the removed `CheckForSals3Action` established.
 */
export default function EvaluationStatusBadge({
  productName,
  evaluation,
  evidence,
}: EvaluationStatusBadgeProps) {
  const [open, setOpen] = useState(false);
  const presentation = presentEvaluationStatus(
    evaluation?.status ?? null,
    evaluation?.attemptCount ?? null,
  );

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${presentation.label} — open evaluation detail for ${productName}`}
        className="cursor-pointer text-left"
        onClick={() => setOpen(true)}
      >
        <StatusPill label={presentation.label} tone={presentation.tone} />
      </button>
      <EvaluationDrawer
        productName={productName}
        evaluation={evaluation}
        evidence={evidence}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
