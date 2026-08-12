import { CircleDashed } from 'lucide-react';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import formatUtcDateTime from '@/lib/portal/format-datetime';
import { ABSENT_COPY } from './copy';

/**
 * `kind` is required, never defaulted. The three absences below are three
 * different facts, and the whole point of this component is that they can never
 * be styled or worded into each other.
 */
type AbsentKind = 'not-fetched' | 'reported-zero' | 'never-recorded';

type CandidateAbsentSectionProps = {
  kind: AbsentKind;
  /**
   * Required for `reported-zero` - it IS the discriminator. A real observation
   * has a capture time; a fetch that never happened cannot have one. Ignored by
   * the other two kinds.
   */
  capturedAt?: Date | null;
  /** What CJ reported none of, or what was never recorded. One sentence. */
  message: string;
};

/**
 * The empty state for a section with no data.
 *
 * Why this exists as its own component: with a captured snapshot on only 19 of
 * 87,966 candidates, "not fetched" is what a reviewer sees almost every time.
 * If it reads like "CJ reported nothing", they will conclude a product has no
 * stock when in fact nobody ever looked - a wrong sourcing decision produced by
 * a styling choice.
 *
 * - `not-fetched` — dashed border, no timestamp. A fact about our pipeline.
 * - `reported-zero` — solid border, timestamp always shown. A fact about the
 *   product, observed at a known instant.
 * - `never-recorded` — plain text. An append-only table with no rows genuinely
 *   means it never happened, so decorating it would only dilute the two above.
 */
export default function CandidateAbsentSection({
  kind,
  capturedAt,
  message,
}: CandidateAbsentSectionProps) {
  if (kind === 'never-recorded') {
    return <p className="text-sm text-ink-muted">{message}</p>;
  }

  if (kind === 'reported-zero') {
    return (
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card px-3 py-2.5">
        <StatusPill
          label={ABSENT_COPY.reportedZeroTitle}
          tone="warning"
          className="w-fit"
        />
        <p className="text-sm">
          {message} Observed {formatUtcDateTime(capturedAt)}.
        </p>
      </div>
    );
  }

  return (
    <div
      role="note"
      className="flex flex-col gap-1.5 rounded-md border border-dashed border-border-strong bg-muted px-3 py-2.5"
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <CircleDashed aria-hidden="true" className="size-4 text-ink-faint" />
        {ABSENT_COPY.notFetchedTitle}
      </span>
      <p className="text-sm text-ink-subtle">{message}</p>
    </div>
  );
}
