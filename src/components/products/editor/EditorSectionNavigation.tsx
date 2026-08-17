import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  sectionIssueCount,
  sectionSeverity,
} from '@/lib/seller-center/product-editor/derive';
import {
  EDITOR_SECTIONS,
  type EditorSectionId,
  type ReadinessIssue,
} from '@/lib/seller-center/product-editor/types';
import { SEVERITY_PRESENTATION } from './presentation';

type EditorSectionNavigationProps = {
  issues: ReadinessIssue[];
  activeSection: EditorSectionId;
  onGoToSection: (section: EditorSectionId) => void;
};

type SectionFlagProps = {
  severity: ReturnType<typeof sectionSeverity>;
  count: number;
};

/** Shorter than the section-card title, so seven labels read as a calm row instead of a wrapped paragraph. */
const NAV_LABELS: Record<EditorSectionId, string> = {
  basic: 'Basic Information',
  specification: 'Specification',
  description: 'Description',
  variants: 'Variants & Pricing',
  markets: 'Markets',
  specs: 'Supplier Details',
  review: 'Review & Publish',
};

const FLAG_TONE_CLASSES: Record<'BLOCKER' | 'WARNING', string> = {
  BLOCKER: 'bg-danger-surface text-red-600',
  WARNING: 'bg-warning-surface text-amber-600',
};

/**
 * A compact count badge, not the severity word repeated on every flagged
 * tab - "Specifications ⚠ Warning", "Media ⚠ Warning" read as noise once
 * three of seven tabs say the same word. The icon still distinguishes
 * blocker from warning shape, and the number is real information the old
 * pill did not carry (how many issues, not just "at least one") - so this
 * still is not a colour-only signal, just a denser one.
 *
 * Pinned to the label's own top-right corner (`absolute`, on a `relative`
 * button), not sat inline after the text with a gap - a notification badge
 * overlapping the thing it flags reads as attached to it; one floating a
 * gap to the right of a short label like "Specifications" reads as
 * unrelated to it, especially once seven labels of different lengths put
 * that gap at a different distance every time.
 */
function SectionFlag({ severity, count }: SectionFlagProps) {
  if (severity === null || count === 0) return null;

  const presentation = SEVERITY_PRESENTATION[severity];
  const Icon = presentation.icon;
  const noun = count === 1 ? 'issue' : 'issues';

  return (
    <span
      aria-label={`${count} ${presentation.label.toLowerCase()} ${noun}`}
      className={cn(
        'pointer-events-none absolute -top-1.5 -right-1.5 inline-flex items-center gap-0.5 rounded-full px-1 py-0.5 text-[10px] font-semibold tabular-nums ring-2 ring-card',
        FLAG_TONE_CLASSES[severity],
      )}
    >
      <Icon aria-hidden="true" className="size-2.5" />
      {count}
    </span>
  );
}

/**
 * Jump list across the seven sections, sticky under the portal top bar.
 *
 * Two presentations of the same data live here, switched by a **container**
 * query on the main editor column rather than a viewport media query or a
 * JavaScript width measurement - the same reasoning `ProductEditorWorkspace`
 * uses for its own grid:
 *
 * - Wide: a quiet row of buttons that wraps onto a second line rather than
 *   scrolling. Seven concise labels comfortably wrap within the column's
 *   760px+ minimum width, so this never needs a scrollbar or a measured
 *   overflow menu.
 * - Narrow (tablet/mobile, or a wide viewport with the portal sidebar
 *   expanded): a single labelled `<select>` - one control instead of a
 *   cramped, wrapped button row competing with the section below it.
 *
 * Each entry carries the worst severity in its section, so a blocker three
 * screens down is visible without scrolling to find it. The indicator is an
 * icon plus the issue count for that section, not a coloured dot - a dot
 * alone would be exactly the colour-only status signal the design system
 * rejects, and the count is real information a bare severity word was not
 * carrying. Touch targets are
 * 44px on small screens.
 */
export default function EditorSectionNavigation({
  issues,
  activeSection,
  onGoToSection,
}: EditorSectionNavigationProps) {
  return (
    <nav
      aria-label="Editor sections"
      className="sticky top-14 z-20 rounded-lg border border-border bg-card p-1 @min-[40rem]:p-1.5"
    >
      <div className="flex flex-wrap gap-1 @min-[40rem]:hidden">
        <Label htmlFor="editor-section-jump" className="sr-only">
          Jump to section
        </Label>
        <select
          id="editor-section-jump"
          value={activeSection}
          onChange={(event) =>
            onGoToSection(event.target.value as EditorSectionId)
          }
          className="h-11 w-full min-w-0 rounded-md border border-border bg-background px-2.5 text-[13px] font-medium"
        >
          {EDITOR_SECTIONS.map((section) => {
            const severity = sectionSeverity(issues, section.id);
            const suffix =
              severity === null
                ? ''
                : ` — ${severity === 'BLOCKER' ? 'Blocker' : 'Warning'}`;

            return (
              <option key={section.id} value={section.id}>
                {NAV_LABELS[section.id]}
                {suffix}
              </option>
            );
          })}
        </select>
        <SectionFlag
          severity={sectionSeverity(issues, activeSection)}
          count={sectionIssueCount(issues, activeSection)}
        />
      </div>

      <div
        className="hidden flex-wrap gap-x-2.5 gap-y-1.5 @min-[40rem]:flex"
        aria-hidden={false}
      >
        {EDITOR_SECTIONS.map((section) => {
          const severity = sectionSeverity(issues, section.id);
          const isActive = section.id === activeSection;

          return (
            <button
              key={section.id}
              type="button"
              aria-current={isActive ? 'true' : undefined}
              onClick={() => onGoToSection(section.id)}
              className={`relative inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-md px-2.5 text-[13px] whitespace-nowrap transition-colors sm:min-h-8 ${
                isActive
                  ? 'bg-accent font-semibold text-brand-900'
                  : 'font-medium text-ink-muted hover:bg-muted'
              }`}
            >
              {NAV_LABELS[section.id]}
              <SectionFlag
                severity={severity}
                count={sectionIssueCount(issues, section.id)}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
