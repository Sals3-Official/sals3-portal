'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type CandidateRowProps = {
  /** Already carries the current tab, search, and page - see `candidateDrawerHref`. */
  href: string;
  /** The row's accessible name, e.g. `Open candidate detail for Blue mug`. */
  label: string;
  children: ReactNode;
  className?: string;
};

/**
 * The one clickable row for every Product Sourcing tab.
 *
 * Only the click-to-navigate lives on the client. The cells stay server-rendered
 * and arrive as `children`, so adding a row click does not pull five table
 * components - or any candidate data, formatter, or copy string - into the
 * client bundle.
 *
 * `router.push` rather than a wrapping `<Link>`: a `<tr>` cannot contain an
 * anchor that spans every cell without breaking table semantics. The recorded
 * cost is that middle-click and open-in-new-tab do not work on the row; the
 * resulting URL is still fully shareable, which is the property that was asked
 * for. `scroll: false` keeps the list behind the drawer where it was.
 */

/**
 * Every tab already renders controls INSIDE rows - "Customize & List" on
 * Ready/Needs Attention, "Recheck now" on Blocked, a tooltip trigger on
 * Exception. Without this guard, clicking any of them would also open the
 * drawer. `closest` cannot match the row itself: a `<tr>` carrying
 * `role="button"` is not an `a` or `button` element.
 *
 * `[role="checkbox"]` is here because not every control is a native element.
 * base-ui's `Checkbox.Root` "renders a `<span>` element and a hidden `<input>`
 * beside" (`nativeButton` defaults to false) - the input is a SIBLING, not a
 * child - so the click that starts on the visible box matches neither `button`
 * nor `input`, and the Select column on Product Sourcing opened the drawer on
 * every tick.
 *
 * Do NOT add `[role="button"]` to this list. `closest` includes the element it
 * starts from, and the row itself carries `role="button"`, so that entry would
 * swallow every row click rather than only the nested ones.
 */
const INTERACTIVE_DESCENDANTS =
  'a,button,input,select,textarea,[role="checkbox"],[role="menuitem"]';

/** True when the event came from a control inside the row rather than the row itself. */
function fromNestedControl(event: MouseEvent<HTMLTableRowElement>): boolean {
  return (
    (event.target as HTMLElement).closest(INTERACTIVE_DESCENDANTS) !== null
  );
}

function isActivationKey(event: KeyboardEvent<HTMLTableRowElement>): boolean {
  return (
    event.target === event.currentTarget &&
    (event.key === 'Enter' || event.key === ' ')
  );
}

export default function CandidateRow({
  href,
  label,
  children,
  className,
}: CandidateRowProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function open() {
    // Guard, not a nicety: without it a second click on an already-pending row
    // queues a second identical navigation. `pending` is per row instance, so a
    // DIFFERENT row is never blocked by this one.
    if (pending) return;

    startTransition(() => router.push(href, { scroll: false }));
  }

  return (
    <TableRow
      role="button"
      tabIndex={0}
      aria-label={label}
      // `aria-busy` is the only correct announcement available here: a live
      // region cannot be a `<tr>` child. The outcome IS spoken - the drawer
      // mounts, focus moves into it, and base-ui announces the dialog - so only
      // the interval in between is silent.
      aria-busy={pending}
      data-pending={pending ? '' : undefined}
      onClick={(event) => {
        if (fromNestedControl(event)) return;

        open();
      }}
      onKeyDown={(event) => {
        if (!isActivationKey(event)) return;

        event.preventDefault();
        open();
      }}
      // The pending affordance has to be something the `<tr>` itself can carry:
      // the cells arrive as opaque `children` from five tables with five
      // different column counts, so appending a spinner cell would break that
      // one row's alignment. `bg-accent` is the design system's "row you acted
      // on" surface, `TableRow` already carries `transition-colors`, and
      // `globals.css` neutralises the pulse under `prefers-reduced-motion` -
      // leaving colour as the signal, so motion is never the only cue.
      className={cn(
        'cursor-pointer data-pending:animate-pulse data-pending:cursor-wait data-pending:bg-accent',
        className,
      )}
    >
      {children}
    </TableRow>
  );
}
