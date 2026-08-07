import type { ReactNode } from 'react';
import type { IssueSeverity } from '@/lib/seller-center/product-editor/types';
import EditorStatusPill from './EditorStatusPill';
import { sectionBadge } from './presentation';

type EditorSectionCardProps = {
  /** Anchor target for "Go to section". Rendered as `sec-<id>`. */
  id: string;
  title: string;
  /** Worst severity found in this section, or `null` for none. */
  severity: IssueSeverity | null;
  /** Extra header content, e.g. a count. Sits before the status badge. */
  meta?: ReactNode;
  children: ReactNode;
};

/**
 * The white card every editor section lives in.
 *
 * `scroll-mt-24` matters: the section nav and the top bar are both sticky,
 * so an un-offset anchor jump lands the heading underneath them.
 *
 * The badge comes from `sectionSeverity()`, the same function the section
 * navigation reads, so a section cannot show "No issues" while the nav
 * shows a blocker for it.
 */
export default function EditorSectionCard({
  id,
  title,
  severity,
  meta,
  children,
}: EditorSectionCardProps) {
  return (
    <section
      id={`sec-${id}`}
      aria-labelledby={`sec-${id}-heading`}
      className="scroll-mt-24 rounded-lg border border-border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5">
        <h2
          id={`sec-${id}-heading`}
          className="font-display text-base font-semibold"
        >
          {title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {meta}
          <EditorStatusPill presentation={sectionBadge(severity)} />
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}
