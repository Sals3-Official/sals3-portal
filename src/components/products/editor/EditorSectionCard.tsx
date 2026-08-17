import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  /**
   * Whether the whole header row toggles the body open/closed. Used for
   * supplementary sections (Supplier Details) that a seller reads
   * occasionally rather than edits every visit - the badge and meta stay
   * visible either way, so a blocker is never hidden by being collapsed.
   */
  collapsible?: boolean;
  /**
   * Uncontrolled initial state. Ignored once `open` is passed - only read
   * when `collapsible` is true either way.
   */
  defaultOpen?: boolean;
  /**
   * Controlled open state, so "Go to section" can expand a collapsed
   * section on the way to it rather than scrolling to a blocker the seller
   * cannot see. Pair with `onOpenChange`; omit both for an uncontrolled
   * section that only the seller's own click ever opens or closes.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
  collapsible = false,
  defaultOpen = false,
  open,
  onOpenChange,
}: EditorSectionCardProps) {
  // A `<button>` may contain a heading's phrasing content, but a heading
  // element cannot itself sit inside a `<button>` - so the toggle wraps just
  // the title text, inside the `<h2>`, rather than the whole header row.
  // Meta and the status badge stay outside it, non-interactive and visible
  // in both states, so a blocker is never hidden by collapsing the section.
  const titleHeading = (
    <h2
      id={`sec-${id}-heading`}
      className="font-display text-base font-semibold"
    >
      {collapsible ? (
        <CollapsibleTrigger className="flex cursor-pointer items-center gap-1.5 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          {title}
          <ChevronDown
            aria-hidden="true"
            className="size-4 text-muted-foreground transition-transform group-data-[open]:rotate-180"
          />
        </CollapsibleTrigger>
      ) : (
        title
      )}
    </h2>
  );

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5">
      {titleHeading}
      <div className="flex flex-wrap items-center gap-2">
        {meta}
        <EditorStatusPill presentation={sectionBadge(severity)} />
      </div>
    </div>
  );

  if (collapsible) {
    return (
      <Collapsible
        defaultOpen={defaultOpen}
        open={open}
        onOpenChange={onOpenChange}
        render={
          <section
            id={`sec-${id}`}
            aria-labelledby={`sec-${id}-heading`}
            className="group scroll-mt-24 rounded-lg border border-border bg-card"
          />
        }
      >
        {header}
        {/* `keepMounted`: the panel stays in the DOM (marked `hidden` while
            closed, not removed), so its own local state and scroll position
            survive a collapse/expand round trip and the open animation has
            a real height to measure from immediately. Content is correctly
            absent from the accessibility tree while collapsed either way -
            `goToSection` opening the panel first is what makes a blocker
            inside it actually reachable, not this prop. */}
        <CollapsibleContent keepMounted>
          <div className="p-4 @min-[48rem]:p-5">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <section
      id={`sec-${id}`}
      aria-labelledby={`sec-${id}-heading`}
      className="scroll-mt-24 rounded-lg border border-border bg-card"
    >
      {header}
      <div className="p-4 @min-[48rem]:p-5">{children}</div>
    </section>
  );
}
