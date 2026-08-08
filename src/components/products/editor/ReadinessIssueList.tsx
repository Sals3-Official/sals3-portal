import { ArrowRight, Ban, ChevronDown, CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  isPermanentIssue,
  issuesOfSeverity,
} from '@/lib/seller-center/product-editor/derive';
import type {
  EditorSectionId,
  IssueSeverity,
  ReadinessIssue,
} from '@/lib/seller-center/product-editor/types';
import EditorStatusPill from './EditorStatusPill';
import {
  ISSUE_SOURCE_LABELS,
  SEVERITY_GROUP_TITLES,
  SEVERITY_PRESENTATION,
} from './presentation';

type ReadinessIssueListProps = {
  issues: ReadinessIssue[];
  onGoToSection: (section: EditorSectionId) => void;
  /** Caps the rendered rows and appends "View all issues" when there is more. `null` renders every issue. */
  maxVisible?: number | null;
  /** Required when `maxVisible` truncates the list. */
  onViewAll?: () => void;
};

const SEVERITY_ORDER: IssueSeverity[] = ['BLOCKER', 'WARNING', 'SUGGESTION'];

const ACCENT_CLASSES: Record<IssueSeverity, string> = {
  BLOCKER: 'text-red-600',
  WARNING: 'text-amber-600',
  SUGGESTION: 'text-primary',
};

type IssueRowProps = {
  issue: ReadinessIssue;
  onGoToSection: (section: EditorSectionId) => void;
};

/**
 * One quiet row: severity icon, a two-line title, where it applies, and
 * "Go to section" - always visible. Everything else - the full explanation,
 * where the finding came from, and how to resolve it - sits behind a
 * `Details` disclosure so the list reads as a scan, not a wall of prose.
 */
function IssueRow({ issue, onGoToSection }: IssueRowProps) {
  const presentation = SEVERITY_PRESENTATION[issue.severity];
  const { icon: Icon } = presentation;

  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2">
        <Icon
          aria-hidden="true"
          className={`mt-0.5 size-4 shrink-0 ${ACCENT_CLASSES[issue.severity]}`}
        />
        <div className="min-w-0 flex-1">
          <h5 className="line-clamp-2 text-[13px] leading-snug font-semibold">
            {issue.title}
          </h5>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {issue.affectedScope}
          </p>
        </div>
      </div>

      <Collapsible>
        <div className="mt-1.5 ml-6 flex flex-wrap items-center gap-3">
          <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-foreground data-[panel-open]:text-foreground [&[data-panel-open]_svg]:rotate-180">
            Details
            <ChevronDown
              aria-hidden="true"
              className="size-3 transition-transform"
            />
          </CollapsibleTrigger>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => onGoToSection(issue.section)}
          >
            Go to section
            <ArrowRight aria-hidden="true" className="size-3" />
          </Button>
        </div>

        <CollapsibleContent>
          <div className="mt-2 ml-6 flex flex-col gap-2 rounded-md bg-muted/50 p-2.5">
            <p className="text-xs leading-relaxed text-ink-muted">
              {issue.explanation}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <dt className="font-semibold">Source</dt>
              <dd>{ISSUE_SOURCE_LABELS[issue.source]}</dd>
              <dt className="font-semibold">Resolution</dt>
              <dd>{issue.resolution}</dd>
            </dl>
            {/* A permanent reason code is a policy or legal matter with no
                override anywhere in the system. Saying so here stops a
                seller hunting for a setting that does not exist. */}
            {isPermanentIssue(issue) ? (
              <p className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
                <Ban aria-hidden="true" className="size-3" />
                Permanent — no override
              </p>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

type SeverityGroupProps = {
  severity: IssueSeverity;
  issues: ReadinessIssue[];
  onGoToSection: (section: EditorSectionId) => void;
};

function SeverityGroup({
  severity,
  issues,
  onGoToSection,
}: SeverityGroupProps) {
  if (issues.length === 0) return null;

  const presentation = SEVERITY_PRESENTATION[severity];

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <h4 className="text-xs font-bold tracking-wide uppercase">
          {SEVERITY_GROUP_TITLES[severity]}
        </h4>
        <EditorStatusPill
          presentation={presentation}
          label={String(issues.length)}
        />
      </div>

      <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
        {issues.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            onGoToSection={onGoToSection}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Issues grouped by severity, hardest first, as one quiet list rather than a
 * stack of individually bordered cards.
 *
 * A zero blocker count does not render an empty "Hard blockers" group and
 * its explanatory paragraph - it collapses to one positive line, because an
 * empty warning box that still takes up a card's worth of space reads as
 * "something might be missing here" rather than "nothing is wrong here".
 * Warning and suggestion groups follow the same rule and disappear entirely
 * when empty, since the counts in `ReadinessSummary` already say so.
 *
 * `maxVisible` exists for the sticky rail: capping the row count there and
 * linking to the full sheet is what keeps the rail from growing its own
 * tall nested scrollbar full of verbose warnings.
 */
export default function ReadinessIssueList({
  issues,
  onGoToSection,
  maxVisible = null,
  onViewAll,
}: ReadinessIssueListProps) {
  const blockerCount = issuesOfSeverity(issues, 'BLOCKER').length;

  const ordered = SEVERITY_ORDER.flatMap((severity) =>
    issuesOfSeverity(issues, severity),
  );
  const visible = maxVisible === null ? ordered : ordered.slice(0, maxVisible);
  const hiddenCount = ordered.length - visible.length;

  const visibleBySeverity = (severity: IssueSeverity) =>
    visible.filter((issue) => issue.severity === severity);

  return (
    <div className="flex flex-col gap-4">
      {blockerCount === 0 ? (
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-green-600">
          <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
          No publication blockers
        </p>
      ) : (
        <SeverityGroup
          severity="BLOCKER"
          issues={visibleBySeverity('BLOCKER')}
          onGoToSection={onGoToSection}
        />
      )}

      <SeverityGroup
        severity="WARNING"
        issues={visibleBySeverity('WARNING')}
        onGoToSection={onGoToSection}
      />
      <SeverityGroup
        severity="SUGGESTION"
        issues={visibleBySeverity('SUGGESTION')}
        onGoToSection={onGoToSection}
      />

      {hiddenCount > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={onViewAll}
        >
          View all issues ({ordered.length})
        </Button>
      ) : null}
    </div>
  );
}
