'use client';

import { useRouter } from 'next/navigation';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { TableRow } from '@/components/ui/table';

type CandidateRowProps = {
  /** Already carries the current tab, search, and page - see `candidateDrawerHref`. */
  href: string;
  /** The row's accessible name, e.g. `Open candidate detail for Blue mug`. */
  label: string;
  children: ReactNode;
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
 */
const INTERACTIVE_DESCENDANTS =
  'a,button,input,select,textarea,[role="menuitem"]';

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
}: CandidateRowProps) {
  const router = useRouter();

  return (
    <TableRow
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={(event) => {
        if (fromNestedControl(event)) return;

        router.push(href, { scroll: false });
      }}
      onKeyDown={(event) => {
        if (!isActivationKey(event)) return;

        event.preventDefault();
        router.push(href, { scroll: false });
      }}
      className="cursor-pointer"
    >
      {children}
    </TableRow>
  );
}
