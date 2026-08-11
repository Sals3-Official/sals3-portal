import presentEvaluationStatus from '@/components/products/cj/evaluation-status';
import { Progress } from '@/components/ui/progress';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import type { EvaluationStatus } from '@/modules/catalog/candidates/rules/contracts';

type ReadinessStatusHeaderProps = {
  status: EvaluationStatus;
  completionPercent: number;
};

/**
 * Overall state of the draft: what it is, and how close it is.
 *
 * This sits *above* the tab strip on purpose. The status and completion of a
 * listing are facts about the listing, not about the "Issues & Tasks" view of
 * it, and they used to live inside that tab's panel - so switching to Source
 * Changes silently dropped the only two numbers telling the seller whether
 * the draft could publish, and the tab strip was left stranded between the
 * title and the status as an empty band.
 *
 * `justify-between` right-aligns the percentage when the rail is wide enough
 * and lets it wrap under the badge when it is not, so the pair never
 * overlaps in the 272px rail.
 *
 * The status label is `presentEvaluationStatus`, the same wording the
 * sourcing tables and the evaluation drawer already use - the editor does
 * not invent a second vocabulary for the same decision states.
 */
export default function ReadinessStatusHeader({
  status,
  completionPercent,
}: ReadinessStatusHeaderProps) {
  const presentation = presentEvaluationStatus(status);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <StatusPill label={presentation.label} tone={presentation.tone} />
        {/*
          The written percentage is the progress bar's non-colour
          alternative: the bar carries no meaning a screen reader or a
          high-contrast user could otherwise recover.
        */}
        <span className="text-xs text-muted-foreground tabular-nums">
          {completionPercent}% complete
        </span>
      </div>

      <Progress value={completionPercent} aria-label="Listing completeness" />
    </div>
  );
}
