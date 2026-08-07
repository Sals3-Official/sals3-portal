import { ArrowRight, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  SEVERITY_EMPTY_TEXT,
  SEVERITY_GROUP_TITLES,
  SEVERITY_PRESENTATION,
} from './presentation';

type ReadinessIssueListProps = {
  issues: ReadinessIssue[];
  onGoToSection: (section: EditorSectionId) => void;
};

const SEVERITY_ORDER: IssueSeverity[] = ['BLOCKER', 'WARNING', 'SUGGESTION'];

const CARD_STYLES: Record<IssueSeverity, string> = {
  BLOCKER: 'border-l-red-600 bg-danger-surface/40',
  WARNING: 'border-l-amber-600 bg-warning-surface/40',
  SUGGESTION: 'border-l-primary bg-card',
};

type IssueCardProps = {
  issue: ReadinessIssue;
  onGoToSection: (section: EditorSectionId) => void;
};

function IssueCard({ issue, onGoToSection }: IssueCardProps) {
  const presentation = SEVERITY_PRESENTATION[issue.severity];
  const { icon: Icon } = presentation;

  return (
    <li
      className={`rounded-lg border border-border border-l-[3px] p-2.5 ${CARD_STYLES[issue.severity]}`}
    >
      <div className="flex items-start gap-2">
        <Icon
          aria-hidden="true"
          className={`mt-0.5 size-4 shrink-0 ${
            issue.severity === 'BLOCKER' ? 'text-red-600' : ''
          } ${issue.severity === 'WARNING' ? 'text-amber-600' : ''} ${
            issue.severity === 'SUGGESTION' ? 'text-primary' : ''
          }`}
        />
        <div className="min-w-0">
          <h5 className="text-[13px] leading-snug font-semibold">
            {issue.title}
          </h5>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            {issue.explanation}
          </p>
        </div>
      </div>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <dt className="font-semibold">Affects</dt>
        <dd>{issue.affectedScope}</dd>
        <dt className="font-semibold">Source</dt>
        <dd>{ISSUE_SOURCE_LABELS[issue.source]}</dd>
        <dt className="font-semibold">Resolution</dt>
        <dd>{issue.resolution}</dd>
      </dl>

      {/* A permanent reason code is a policy or legal matter with no
          override anywhere in the system. Saying so here stops a seller
          hunting for a setting that does not exist. */}
      {isPermanentIssue(issue) ? (
        <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-red-600">
          <Ban aria-hidden="true" className="size-3" />
          Permanent — no override
        </p>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => onGoToSection(issue.section)}
      >
        Go to section
        <ArrowRight aria-hidden="true" />
      </Button>
    </li>
  );
}

/**
 * Issues grouped by severity, hardest first.
 *
 * This is the error summary the field-level errors point back to, so each
 * item states the same four things every time: what is wrong, what it
 * affects, where the finding came from, and whether anything can be done
 * about it. `PERMANENT_REASON_CODES` genuinely have no resolution path,
 * and the fixture says so rather than offering a false next step.
 */
export default function ReadinessIssueList({
  issues,
  onGoToSection,
}: ReadinessIssueListProps) {
  return (
    <div className="flex flex-col gap-4">
      {SEVERITY_ORDER.map((severity) => {
        const group = issuesOfSeverity(issues, severity);
        const presentation = SEVERITY_PRESENTATION[severity];

        return (
          <section key={severity} className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <h4 className="text-xs font-bold tracking-wide uppercase">
                {SEVERITY_GROUP_TITLES[severity]}
              </h4>
              <EditorStatusPill
                presentation={presentation}
                label={String(group.length)}
              />
            </div>

            {group.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {SEVERITY_EMPTY_TEXT[severity]}
              </p>
            ) : (
              <ul className="flex list-none flex-col gap-2 p-0">
                {group.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    onGoToSection={onGoToSection}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
