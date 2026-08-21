import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import VariantMatrixValueRow from './VariantMatrixValueRow';

const DRAG = {
  isDragging: false,
  isDropTarget: false,
  onDragStart: vi.fn(),
  onDragEnter: vi.fn(),
  onDragEnd: vi.fn(),
  onDrop: vi.fn(),
};

function renderRow(
  overrides: {
    index?: number;
    count?: number;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    withDrag?: boolean;
  } = {},
) {
  return render(
    <VariantMatrixValueRow
      supplierValue="black"
      label="Black"
      maxLength={120}
      onLabelChange={vi.fn()}
      onMoveUp={overrides.onMoveUp ?? vi.fn()}
      onMoveDown={overrides.onMoveDown ?? vi.fn()}
      index={overrides.index ?? 1}
      count={overrides.count ?? 4}
      drag={overrides.withDrag === false ? undefined : DRAG}
    />,
  );
}

function grip() {
  return screen.getByRole('button', { name: /^Reposition black/ });
}

describe('VariantMatrixValueRow', () => {
  it('shows the grip as the only control on the row', () => {
    renderRow();

    expect(grip()).toBeInTheDocument();
    // Neither the arrow pair nor the overflow menu that briefly replaced it.
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  /**
   * The grip must not be a `<button>`. A bare `<button draggable="true">` never
   * fires `dragstart` in Chromium, so the element that drags has to be a span
   * carrying the button role instead.
   */
  it('is a draggable span, not a button element', () => {
    renderRow();

    const handle = grip();

    expect(handle.tagName).toBe('SPAN');
    expect(handle).toHaveAttribute('draggable', 'true');
  });

  it('is absent where dragging is not wired, rather than inert', () => {
    const { container } = renderRow({ withDrag: false });

    expect(container.querySelector('[draggable="true"]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names the keys in its accessible name, because a grip hints at nothing', () => {
    renderRow();

    expect(grip()).toHaveAccessibleName(
      'Reposition black. Press the up or down arrow key to move it.',
    );
  });

  it('moves the value with the arrow keys', () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();

    renderRow({ onMoveUp, onMoveDown });
    fireEvent.keyDown(grip(), { key: 'ArrowUp' });

    expect(onMoveUp).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(grip(), { key: 'ArrowDown' });

    expect(onMoveDown).toHaveBeenCalledTimes(1);
  });

  it('ignores an upward move from the top of the list', () => {
    const onMoveUp = vi.fn();

    renderRow({ index: 0, onMoveUp });
    fireEvent.keyDown(grip(), { key: 'ArrowUp' });

    // Ignored rather than disabled: disabling the focused element is what
    // dropped focus to `<body>` when this was a pair of arrows.
    expect(onMoveUp).not.toHaveBeenCalled();
    expect(grip()).not.toBeDisabled();
  });

  it('ignores a downward move from the bottom of the list', () => {
    const onMoveDown = vi.fn();

    renderRow({ index: 3, count: 4, onMoveDown });
    fireEvent.keyDown(grip(), { key: 'ArrowDown' });

    expect(onMoveDown).not.toHaveBeenCalled();
  });

  it('leaves other keys to the page', () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();

    renderRow({ onMoveUp, onMoveDown });
    fireEvent.keyDown(grip(), { key: 'Enter' });
    fireEvent.keyDown(grip(), { key: 'a' });

    expect(onMoveUp).not.toHaveBeenCalled();
    expect(onMoveDown).not.toHaveBeenCalled();
  });

  it('is reachable by tab and still exposes one editable field', () => {
    renderRow();

    expect(grip()).toHaveAttribute('tabindex', '0');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(
      screen.getByLabelText('Label shown to buyers for black'),
    ).toBeInTheDocument();
  });
});
