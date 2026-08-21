'use client';

import { GripVertical } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { VariantValueDragHandlers } from './use-variant-value-drag';

/**
 * One value of one Variant Matrix axis: the supplier's token, the label buyers
 * read, and the one grip that places it.
 *
 * Extracted because the matrix is edited on two occasions and the two had
 * drifted apart. Naming it for the first time rendered a ledger cell, an input
 * and a pair of reorder arrows; renaming it later rendered a bare `<span>` and
 * an input in a two-column `1fr 1fr` grid — so the token floated alone in the
 * left half, the input in the right, and the order could not be changed at all.
 * A seller who arranged `S, M, L, XL, XXL` while mapping and later corrected one
 * word lost the ability to fix the order that matters most.
 *
 * One row, both callers. The state each holds differs — a proposal keyed by
 * supplier token, a saved axis keyed by value id — so this takes only what it
 * renders and reports intent back out.
 */

/**
 * ## One grip, and why it is a `<span>` rather than a `<button>`
 *
 * The row used to carry a pair of up/down `Button`s, then a grip beside an
 * overflow menu. Both are gone by owner decision on 2026-08-22 — *"alisin mo na
 * yung upward downward arrow kung may drag button na"*, then *"⋮⋮ grip - eto
 * lang dapat meron"*. One control on the row, and it is this.
 *
 * It is deliberately not a `<button>`: **a `<button>` is not a reliable native
 * drag source.** A spike against a bare `<button draggable="true">` with nothing
 * else on it never fired `dragstart` in Chromium, while identical markup as a
 * `<span>` did — Chromium treats a button's mousedown as a press rather than the
 * start of a drag. That is also why the earlier attempt to make one element both
 * a menu trigger and a drag handle failed, and it was not the menu library's
 * fault.
 *
 * So the grip is a focusable `<span role="button">` doing two jobs with no
 * second control:
 *
 * - **Mouse:** drag it onto another row to take that row's position.
 * - **Keyboard:** focus it and press the up or down arrow key. Ordering is the
 *   one thing here no algorithm recovers — `S, M, L, XL, XXL` is alphabetically
 *   `L, M, S, XL, XXL` — so it cannot be mouse-only (WCAG 2.1.1). The label says
 *   which keys do it, because a grip gives no other hint.
 *
 * ## The accepted gap: touch
 *
 * Native HTML5 drag events do not fire from a touchscreen, and a touchscreen has
 * no arrow keys, so **the order of values cannot be changed on a phone.** That
 * is a consequence of one-control-only, not an oversight; WCAG 2.5.7 asks for a
 * single-pointer alternative to dragging and there is none here. Closing it
 * needs pointer-event dragging (`pointerdown`/`pointermove` with
 * `touch-action: none`) rather than the native API — a real change, not a prop.
 *
 * A failure mode disappeared with the arrows: `keepFocusOffDisabledArrow`
 * existed because an arrow disables at its end of the list, and `disabled` on
 * the focused element makes a browser drop focus to `<body>`. The grip is never
 * disabled — a move that would leave the list is simply ignored — so the helper
 * is deleted. `DescriptionBlockEditor` still renders a disabled-at-the-ends
 * arrow pair and still has the underlying problem; it never used this helper,
 * and fixing it there is its own change.
 */

export type VariantMatrixValueRowProps = {
  /** The supplier's own token. Read-only by field-ownership rule. */
  supplierValue: string;
  label: string;
  maxLength: number;
  onLabelChange: (label: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  /** This value's place in its axis, and how many values the axis holds. */
  index: number;
  count: number;
  /**
   * Drag-to-reposition, from `useVariantValueDrag`. Omitted where dragging is
   * not wired, in which case the row renders no grip at all rather than an
   * inert one — the arrows still reorder either way, and they remain the only
   * route on a keyboard or a touchscreen.
   */
  drag?: VariantValueDragHandlers;
};

export default function VariantMatrixValueRow({
  supplierValue,
  label,
  maxLength,
  onLabelChange,
  onMoveUp,
  onMoveDown,
  index,
  count,
  drag,
}: VariantMatrixValueRowProps) {
  return (
    <div
      className={cn(
        'grid items-center gap-2 rounded-md',
        'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]',
        // Receding, not hiding: the row keeps its space so the rows below do
        // not jump while the pointer is still deciding.
        drag?.isDragging === true ? 'opacity-40' : undefined,
        // A ring on the landing row rather than an insertion line: the drop
        // replaces this row's position, so the row is what should be marked.
        drag?.isDropTarget === true
          ? 'outline-2 outline-offset-2 outline-[#018CC9]'
          : undefined,
      )}
      onDragEnter={drag?.onDragEnter}
      onDragOver={
        drag === undefined
          ? undefined
          : (event) => {
              // Without this the browser refuses the drop outright.
              event.preventDefault();

              const { dataTransfer } = event;

              dataTransfer.dropEffect = 'move';
            }
      }
      onDrop={
        drag === undefined
          ? undefined
          : (event) => {
              event.preventDefault();
              drag.onDrop();
            }
      }
    >
      {/*
        A ledger cell, not a field. Text rather than a disabled input; recessed
        surface and mono so it reads as the supplier's own immutable token; and
        right-aligned so it meets the editable label at the gutter — the two
        halves of one mapping in visual contact, which is the whole point of this
        row. Same h-9 keeps the baselines level.
      */}
      <span className="flex h-9 min-w-0 items-center justify-end rounded-md bg-muted/40 px-3">
        <span className="truncate font-mono text-xs text-muted-foreground">
          {supplierValue}
        </span>
      </span>
      <Input
        value={label}
        maxLength={maxLength}
        aria-label={`Label shown to buyers for ${supplierValue}`}
        className="h-9"
        onChange={(event) => onLabelChange(event.target.value)}
      />
      {drag === undefined ? null : (
        <span
          role="button"
          tabIndex={0}
          draggable
          // The keys are in the accessible name because a grip gives no other
          // hint that it can be operated without a mouse.
          aria-label={`Reposition ${supplierValue}. Press the up or down arrow key to move it.`}
          title={`Drag to reposition ${supplierValue}, or focus it and press the up or down arrow key`}
          onDragStart={(event) => {
            const { dataTransfer } = event;

            // Firefox starts no drag unless some data is set.
            dataTransfer.setData('text/plain', supplierValue);
            dataTransfer.effectAllowed = 'move';
            drag.onDragStart();
          }}
          onDragEnd={drag.onDragEnd}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;

            // Otherwise the page scrolls under the seller while the value moves.
            event.preventDefault();

            // A move off either end is ignored rather than disabling the grip:
            // disabling the focused element is what dropped focus to `<body>`
            // when this was a pair of arrows.
            if (event.key === 'ArrowUp') {
              if (index > 0) onMoveUp();

              return;
            }

            if (index < count - 1) onMoveDown();
          }}
          className="flex size-7 cursor-grab items-center justify-center rounded-md text-muted-foreground outline-offset-2 active:cursor-grabbing hover:bg-muted focus-visible:outline-2"
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </span>
      )}
    </div>
  );
}
