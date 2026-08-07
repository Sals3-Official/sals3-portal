'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

type EditorSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
};

/**
 * The editor's side panels when they do not fit beside the workspace.
 *
 * Two things this wrapper fixes for every panel at once, rather than each
 * caller getting them right separately:
 *
 * - **Width.** The shared `sheet` primitive is 75% wide by default, which
 *   leaves a useless sliver of page behind it on a phone and squeezes a
 *   variant table or an issue list. These panels go full width below `sm`.
 * - **Initial focus.** The panels are opened from state rather than from a
 *   `SheetTrigger`, and focus does not reliably land inside the dialog in
 *   that case. Without it a keyboard or screen-reader user opens the panel
 *   and is left at the top of the page behind it. Focusing the content
 *   region moves them in; the primitive still handles Escape and returning
 *   focus on close.
 */
export default function EditorSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: EditorSheetProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    const frame = requestAnimationFrame(() => contentRef.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        aria-label={title}
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description === undefined ? null : (
            <SheetDescription>{description}</SheetDescription>
          )}
        </SheetHeader>
        <div ref={contentRef} tabIndex={-1} className="px-4 pb-6 outline-none">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
