'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Moves focus into a sheet that was opened from state rather than from a
 * `SheetTrigger`.
 *
 * base-ui returns focus on close and handles Escape on its own, but it does not
 * reliably land focus inside the dialog when `open` flips from external state
 * with no trigger element to return to. Without this, a keyboard or
 * screen-reader user opens the panel and is left at the top of the page behind
 * it.
 *
 * Extracted from `EditorSheet`, which had this inline, so the candidate detail
 * sheet does not duplicate the same `requestAnimationFrame` trick. The frame
 * matters: focusing synchronously runs before the popup is in the document.
 *
 * Attach the returned ref to a `tabIndex={-1}` element inside the sheet.
 */
export default function useSheetInitialFocus(
  open: boolean,
): RefObject<HTMLDivElement | null> {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    const frame = requestAnimationFrame(() => contentRef.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, [open]);

  return contentRef;
}
