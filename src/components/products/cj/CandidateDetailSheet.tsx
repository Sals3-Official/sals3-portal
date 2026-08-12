'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import useSheetInitialFocus from '@/hooks/use-sheet-initial-focus';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

type CandidateDetailSheetProps = {
  /** Where to navigate on close - drops `?candidate=` and keeps the rest. */
  closeHref: string;
  /**
   * Only used to reset the local close override when the URL swaps one candidate
   * for another (back/forward, or a pasted link) without unmounting this panel.
   */
  candidateId: string;
  title: string;
  description?: string;
  children: ReactNode;
};

/**
 * The 85%-wide read-only candidate detail panel.
 *
 * Mounted only when `?candidate=` is set, so it is open whenever it exists;
 * closing is a navigation, not a state flip, which is what makes the view
 * shareable and the back button behave.
 *
 * ## Width
 *
 * The shared primitive defaults to `data-[side=right]:w-3/4` AND
 * `data-[side=right]:sm:max-w-sm`. BOTH must be beaten, and each class below
 * repeats the default's exact modifier set so `tailwind-merge` treats it as a
 * conflict and drops the default rather than emitting both:
 *
 * - `data-[side=right]:w-full` beats `w-3/4`.
 * - `data-[side=right]:sm:max-w-none` beats the 24rem cap. Forgetting this one
 *   renders a 384px panel against a 768px viewport - the failure mode that
 *   looks like the drawer "didn't take the width".
 * - the two `md:` classes are the actual 85%. Different modifier set, so both
 *   survive the merge, and Tailwind emits the `md` block last so it wins by
 *   cascade order.
 *
 * Below `md` the panel is full width, not 85vw: 85% of a 375px phone leaves a
 * 56px strip that is both useless and the backdrop's dismiss target, sitting
 * right under a thumb.
 */
const WIDTH_CLASSES =
  'data-[side=right]:w-full data-[side=right]:sm:max-w-none md:data-[side=right]:w-[85vw] md:data-[side=right]:max-w-[85vw]';

export default function CandidateDetailSheet({
  closeHref,
  candidateId,
  title,
  description,
  children,
}: CandidateDetailSheetProps) {
  const router = useRouter();
  const contentRef = useSheetInitialFocus(true);
  /**
   * An override, never the source of truth. This component is mounted only while
   * `?candidate=` is set, so being mounted already means "open"; `closing` just
   * lets the panel run ahead of the URL.
   *
   * Without it, pressing the X waited on a full server render - the tab's count
   * and page queries and the seven detail statements - before anything moved, so
   * a click that should feel instant felt broken. The server render still
   * happens; it just no longer blocks the animation.
   */
  const [closing, setClosing] = useState(false);
  const [, startTransition] = useTransition();
  /**
   * Resets the override when the URL swaps one candidate for another (back /
   * forward, or a pasted link) without unmounting this panel.
   *
   * Adjusted during render rather than in an effect: React re-renders
   * immediately without committing the first pass, so the panel never paints a
   * frame in the wrong state. An effect would paint the closed panel first and
   * then reopen it, which is also what `react-hooks/set-state-in-effect` exists
   * to stop. `key={candidateId}` on the parent would work too, but it remounts
   * base-ui's popup and replays the slide-in for what is only a content swap.
   */
  const [renderedId, setRenderedId] = useState(candidateId);

  if (renderedId !== candidateId) {
    setRenderedId(candidateId);
    setClosing(false);
  }

  return (
    <Sheet
      open={!closing}
      onOpenChange={(open) => {
        // Idempotent on purpose: Escape twice, or Escape then a click on the X,
        // must still produce exactly one navigation.
        if (open || closing) return;

        setClosing(true);
        startTransition(() => router.push(closeHref, { scroll: false }));
      }}
    >
      {/*
        No `aria-label` here, unlike `EditorSheet`. base-ui already points
        `aria-labelledby` at `SheetTitle`, and per the accessible-name spec that
        beats `aria-label` - so an `aria-label` would be dead weight that reads
        as a working override. Verified against the rendered DOM: the popup
        carries `role="dialog"`, `aria-labelledby`, and `aria-describedby`.

        The consequence for tests: the dialog's accessible name is the product
        name, which nobody controls in a real database, so the e2e addresses it
        as `getByRole('dialog')` with no name.
      */}
      <SheetContent className={WIDTH_CLASSES}>
        <SheetHeader className="pr-12">
          <SheetTitle>{title}</SheetTitle>
          {description === undefined ? null : (
            <SheetDescription>{description}</SheetDescription>
          )}
        </SheetHeader>
        {/*
          The scroll lives here, not on `SheetContent`, so the header and the tab
          bar stay pinned. A tab bar that scrolls out of reach defeats tabbing.
        */}
        <div
          ref={contentRef}
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 outline-none"
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
