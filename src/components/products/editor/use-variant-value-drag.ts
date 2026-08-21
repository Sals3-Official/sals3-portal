'use client';

import { useState } from 'react';

/**
 * Dragging one Variant Matrix value to a new position.
 *
 * ## Alongside the arrows, never instead of them
 *
 * `VariantMatrixValueRow` already reorders with up/down buttons, and its own
 * note records why they were chosen: *"Up/down buttons rather than drag: drag
 * alone is unreachable by keyboard, and this needs no new dependency."* Both
 * halves of that still hold. So drag is added as a second way to do the same
 * thing, and the arrows stay the accessible one — `S, M, L, XL, XXL` has to be
 * reachable without a mouse, and native HTML5 drag events do not fire from a
 * touchscreen either, so on a phone the arrows are the *only* way.
 *
 * The grip is therefore a mouse affordance layered over a working control, not
 * the control itself: it is `aria-hidden` and not focusable, because announcing
 * a handle that cannot be operated from the keyboard offers a route that dead
 * ends.
 *
 * ## Native events, no library
 *
 * `draggable` plus `dragstart`/`dragover`/`drop` — no `dnd-kit`, no
 * `react-beautiful-dnd`, nothing added to `package.json`. This reorders at most
 * a handful of rows inside one card; a drag library is several tens of
 * kilobytes to do what four event handlers already do.
 *
 * ## Why the axis is part of the state and not of the drag payload
 *
 * `dataTransfer` could carry the source index, but the browser exposes its
 * contents only on `drop` — an axis read that late cannot stop the *hover*
 * highlight appearing on a row in the wrong card. Holding the source here means
 * a drag that started in `Colour` never highlights, and never lands on, a row
 * in `Size`.
 */

export type VariantValueDragSource = { axisIndex: number; valueIndex: number };

export type VariantValueDragHandlers = {
  /** True for the row being dragged, so it can recede while it moves. */
  isDragging: boolean;
  /** True for the row the value would land on if dropped now. */
  isDropTarget: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
};

export type UseVariantValueDrag = {
  /** Whether any drag is in progress, for a cursor or container affordance. */
  isDragging: boolean;
  rowHandlers: (
    axisIndex: number,
    valueIndex: number,
  ) => VariantValueDragHandlers;
};

export default function useVariantValueDrag(
  onReorder: (axisIndex: number, from: number, to: number) => void,
): UseVariantValueDrag {
  const [source, setSource] = useState<VariantValueDragSource | null>(null);
  const [over, setOver] = useState<number | null>(null);

  function end() {
    setSource(null);
    setOver(null);
  }

  return {
    isDragging: source !== null,
    rowHandlers: (axisIndex, valueIndex) => ({
      isDragging:
        source !== null &&
        source.axisIndex === axisIndex &&
        source.valueIndex === valueIndex,
      /**
       * Highlighted only for a row in the axis the drag started in, and never
       * for the dragged row itself — a row cannot be dropped onto where it
       * already is, so offering it as a target promises a move that does
       * nothing.
       */
      isDropTarget:
        source !== null &&
        source.axisIndex === axisIndex &&
        source.valueIndex !== valueIndex &&
        over === valueIndex,
      onDragStart: () => {
        setSource({ axisIndex, valueIndex });
        setOver(null);
      },
      onDragEnter: () => {
        if (source === null || source.axisIndex !== axisIndex) return;

        setOver(valueIndex);
      },
      onDragEnd: end,
      onDrop: () => {
        if (
          source === null ||
          source.axisIndex !== axisIndex ||
          source.valueIndex === valueIndex
        ) {
          end();

          return;
        }

        onReorder(axisIndex, source.valueIndex, valueIndex);
        end();
      },
    }),
  };
}
