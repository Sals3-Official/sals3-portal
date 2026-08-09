import { Label } from '@/components/ui/label';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { sectionSeverity } from '@/lib/seller-center/product-editor/derive';
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
};

/** Shorter than the section-card title, so seven labels read as a calm row instead of a wrapped paragraph. */
const NAV_LABELS: Record<EditorSectionId, string> = {
  basic: 'Basic Information',
  specs: 'Specifications',
  description: 'Description',
  variants: 'Variants & Pricing',
  markets: 'Markets & Shipping',
  media: 'Media',
  review: 'Review & Publish',
};

/**
 * The same bounded pill used everywhere else a severity needs a word plus an
 * icon (`EditorStatusPill`, the readiness issue groups) - loose coloured
 * text floating next to a variable-length label is what made a wrapped row
 * of seven tabs read as ragged/misaligned. A pill has a fixed height and a
 * visible edge, so the row stays tidy regardless of which labels wrap.
 */
function SectionFlag({ severity }: SectionFlagProps) {
  if (severity === null) return null;

  const presentation = SEVERITY_PRESENTATION[severity];

  return (
    <StatusPill
      label={presentation.label}
      tone={presentation.tone}
      icon={presentation.icon}
      className="pointer-events-none"
    />
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
 * screens down is visible without scrolling to find it. The indicator is a
 * word plus an icon, not a coloured dot - a dot alone would be exactly the
 * colour-only status signal the design system rejects. Touch targets are
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
        <SectionFlag severity={sectionSeverity(issues, activeSection)} />
      </div>

      <div
        className="hidden flex-wrap gap-1 @min-[40rem]:flex"
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
              className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] whitespace-nowrap transition-colors sm:min-h-8 ${
                isActive
                  ? 'bg-accent font-semibold text-brand-900'
                  : 'font-medium text-ink-muted hover:bg-muted'
              }`}
            >
              {NAV_LABELS[section.id]}
              <SectionFlag severity={severity} />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
