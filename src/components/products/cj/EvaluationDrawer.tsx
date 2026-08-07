'use client';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { CandidateEvidence } from '@/lib/cj/evidence';
import type { CandidateEvaluationRow } from '@/lib/db/schema';
import {
  REASON_CODE_EXPLANATIONS,
  type ReasonCode,
} from '@/modules/catalog/candidates/rules/contracts';
import CandidateEvidencePanel from './CandidateEvidencePanel';
import presentEvaluationStatus from './evaluation-status';

type EvaluationDrawerProps = {
  productName: string;
  evaluation: CandidateEvaluationRow | null;
  evidence: CandidateEvidence | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Detail panel for one candidate's automated evaluation. Shows the decision,
 * its reason codes in plain language, the stored evidence summary, and the
 * full CJ evidence facts when a snapshot exists (`CandidateEvidencePanel`,
 * unchanged) - never a score, since none is genuinely computed
 * (`candidate_evaluations.score` is reserved and always null).
 */
export default function EvaluationDrawer({
  productName,
  evaluation,
  evidence,
  open,
  onOpenChange,
}: EvaluationDrawerProps) {
  const presentation = presentEvaluationStatus(evaluation?.status ?? null);
  const reasonCodes = (evaluation?.reasonCodes ?? []) as ReasonCode[];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        aria-label={`Evaluation detail for ${productName}`}
        className="overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>{productName}</SheetTitle>
          <SheetDescription>{presentation.label}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6 text-sm text-ink-muted">
          <p>{presentation.description}</p>

          {reasonCodes.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-foreground uppercase">
                Reasons
              </h3>
              <ul className="flex flex-col gap-1.5 text-sm">
                {reasonCodes.map((code) => (
                  <li key={code}>
                    <span className="font-medium text-foreground">{code}</span>{' '}
                    — {REASON_CODE_EXPLANATIONS[code]}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {evaluation !== null ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="font-medium text-foreground">Candidate ID</dt>
              <dd className="font-mono text-xs break-all">
                {evaluation.candidateId}
              </dd>
              <dt className="font-medium text-foreground">Policy version</dt>
              <dd className="font-mono text-xs">{evaluation.policyVersion}</dd>
              <dt className="font-medium text-foreground">Last evaluated</dt>
              <dd>
                {evaluation.evaluatedAt
                  ? new Date(evaluation.evaluatedAt).toLocaleString()
                  : 'Not yet evaluated'}
              </dd>
            </dl>
          ) : null}

          {evidence !== null ? (
            <CandidateEvidencePanel evidence={evidence} />
          ) : (
            <p role="alert">
              No CJ evidence is stored for this candidate yet - either it has
              not reached the evidence-fetch stage, or the fetch could not
              complete. This means &quot;not fetched&quot;, never &quot;there is
              nothing&quot;.
            </p>
          )}

          <p>
            No quality score or publish decision beyond the status above is
            computed for this candidate.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
