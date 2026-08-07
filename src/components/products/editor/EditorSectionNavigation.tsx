import { OctagonAlert, TriangleAlert } from 'lucide-react';
import { sectionSeverity } from '@/lib/seller-center/product-editor/derive';
import {
  EDITOR_SECTIONS,
  type EditorSectionId,
  type ReadinessIssue,
} from '@/lib/seller-center/product-editor/types';

type EditorSectionNavigationProps = {
  issues: ReadinessIssue[];
  activeSection: EditorSectionId;
  onGoToSection: (section: EditorSectionId) => void;
};

type SectionFlagProps = {
  severity: ReturnType<typeof sectionSeverity>;
};

function SectionFlag({ severity }: SectionFlagProps) {
  if (severity === 'BLOCKER') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600">
        <OctagonAlert aria-hidden="true" className="size-3.5" />
        Blocker
      </span>
    );
  }

  if (severity === 'WARNING') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600">
        <TriangleAlert aria-hidden="true" className="size-3.5" />
        Warning
      </span>
    );
  }

  return null;
}

/**
 * Jump list across the seven sections, sticky under the portal top bar.
 *
 * Each entry carries the worst severity in its section, so a blocker three
 * screens down is visible without scrolling to find it. The indicator is a
 * word plus an icon, not a coloured dot - a dot alone would be exactly the
 * colour-only status signal the design system rejects.
 *
 * It scrolls horizontally rather than wrapping, so the row height stays
 * predictable at every width; targets are 44px on small screens.
 */
export default function EditorSectionNavigation({
  issues,
  activeSection,
  onGoToSection,
}: EditorSectionNavigationProps) {
  return (
    <nav
      aria-label="Editor sections"
      className="sticky top-14 z-20 flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1"
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
            {section.label}
            <SectionFlag severity={severity} />
          </button>
        );
      })}
    </nav>
  );
}
