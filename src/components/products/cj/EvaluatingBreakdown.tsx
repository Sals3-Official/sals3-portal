import StatusPill from '@/components/seller-center/shared/StatusPill';
import type { PipelinePageData } from '@/modules/catalog/candidates/pipeline-page-data';

/**
 * Splits the Queued / Evaluating tab's single count into the two states a
 * reviewer actually cares about: rows waiting for a worker, and rows a worker
 * currently holds. One combined number cannot tell "the queue is deep" apart
 * from "the processor is stuck".
 *
 * Renders nothing when no real count was resolvable - a guessed zero would read
 * as "the queue is empty".
 */
export default function EvaluatingBreakdown({
  counts,
}: {
  counts: PipelinePageData['counts'];
}) {
  if (counts === null) return null;

  return (
    <div className="flex flex-wrap gap-2">
      <StatusPill
        label={`Queued ${counts.evaluatingQueued.toLocaleString()}`}
        tone="neutral"
        className="w-fit"
      />
      <StatusPill
        label={`Processing now ${counts.evaluatingProcessing.toLocaleString()}`}
        tone="info"
        className="w-fit"
      />
    </div>
  );
}
