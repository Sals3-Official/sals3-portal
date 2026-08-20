'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * One value of one Variant Matrix axis: the supplier's token, the label buyers
 * read, and the two arrows that place it.
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
 * Reordering with the keyboard must not drop focus.
 *
 * Each arrow disables at its end of the list, and `disabled` on the element that
 * currently holds focus makes the browser drop focus to `<body>`. So the last
 * press of a run — the one that lands the value where the seller wanted it —
 * silently loses their place. That hurts most in exactly the case these buttons
 * exist for: `S, M, L, XL, XXL` is recoverable by no algorithm, so the order is
 * set by hand, and by keyboard for anyone not using a mouse.
 *
 * Focus moves to the opposite arrow in the same row, which is always enabled
 * after a move that lands on a boundary — an axis carries at least two values,
 * so the two ends are never the same row. It is handed over before the state
 * update: the sibling is not unmounted, so React keeps focus on it, and the row
 * carries that focus with it as it moves.
 */
export function keepFocusOffDisabledArrow(
  pressed: HTMLButtonElement,
  willDisable: boolean,
): void {
  if (!willDisable) return;

  const sibling = pressed.nextElementSibling ?? pressed.previousElementSibling;

  if (sibling instanceof HTMLButtonElement) sibling.focus();
}

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
}: VariantMatrixValueRowProps) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
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
      {/* gap-2, not gap-1: two opposite-action targets 4px apart invite a
          mis-tap that undoes the move just made. */}
      <span className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Move ${supplierValue} up`}
          disabled={index === 0}
          onClick={(event) => {
            // The destination decides: a value landing at the top disables the
            // arrow that just moved it.
            keepFocusOffDisabledArrow(event.currentTarget, index - 1 === 0);
            onMoveUp();
          }}
        >
          <ChevronUp aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`Move ${supplierValue} down`}
          disabled={index === count - 1}
          onClick={(event) => {
            keepFocusOffDisabledArrow(
              event.currentTarget,
              index + 1 === count - 1,
            );
            onMoveDown();
          }}
        >
          <ChevronDown aria-hidden="true" />
        </Button>
      </span>
    </div>
  );
}
