'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
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
  title,
  description,
  children,
}: CandidateDetailSheetProps) {
  const router = useRouter();
  const contentRef = useSheetInitialFocus(true);

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(closeHref, { scroll: false });
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
