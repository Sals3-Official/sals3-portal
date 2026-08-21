import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useVariantValueDrag, {
  type UseVariantValueDrag,
} from './use-variant-value-drag';

/**
 * The hook is exercised through a host component rather than a renderer helper,
 * because every assertion here is about what one row is told about itself while
 * another row is being dragged.
 */
function host(onReorder: (axis: number, from: number, to: number) => void) {
  let api: UseVariantValueDrag | null = null;

  function Host() {
    api = useVariantValueDrag(onReorder);

    return null;
  }

  render(<Host />);

  return () => {
    if (api === null) throw new Error('hook did not run');

    return api;
  };
}

describe('useVariantValueDrag', () => {
  it('reorders to the row the value was dropped on', () => {
    const onReorder = vi.fn();
    const api = host(onReorder);

    act(() => api().rowHandlers(0, 0).onDragStart());
    act(() => api().rowHandlers(0, 3).onDragEnter());
    act(() => api().rowHandlers(0, 3).onDrop());

    expect(onReorder).toHaveBeenCalledWith(0, 0, 3);
  });

  it('refuses a drop from a different axis', () => {
    const onReorder = vi.fn();
    const api = host(onReorder);

    act(() => api().rowHandlers(0, 0).onDragStart());
    act(() => api().rowHandlers(1, 1).onDrop());

    // A value belongs to one axis. Moving it into another would put a colour
    // token at a size position.
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('refuses a drop onto the dragged row itself', () => {
    const onReorder = vi.fn();
    const api = host(onReorder);

    act(() => api().rowHandlers(0, 2).onDragStart());
    act(() => api().rowHandlers(0, 2).onDrop());

    expect(onReorder).not.toHaveBeenCalled();
  });

  it('marks only the dragged row as dragging', () => {
    const api = host(vi.fn());

    act(() => api().rowHandlers(0, 1).onDragStart());

    expect(api().rowHandlers(0, 1).isDragging).toBe(true);
    expect(api().rowHandlers(0, 2).isDragging).toBe(false);
    expect(api().rowHandlers(1, 1).isDragging).toBe(false);
    expect(api().isDragging).toBe(true);
  });

  it('never highlights a row in another axis', () => {
    const api = host(vi.fn());

    act(() => api().rowHandlers(0, 0).onDragStart());
    act(() => api().rowHandlers(1, 1).onDragEnter());

    // The guard is in `onDragEnter`, not only in `onDrop`: a highlight in the
    // wrong card would promise a move that is then refused.
    expect(api().rowHandlers(1, 1).isDropTarget).toBe(false);
  });

  it('never highlights the dragged row as its own target', () => {
    const api = host(vi.fn());

    act(() => api().rowHandlers(0, 1).onDragStart());
    act(() => api().rowHandlers(0, 1).onDragEnter());

    expect(api().rowHandlers(0, 1).isDropTarget).toBe(false);
  });

  it('clears the drag when it ends without a drop', () => {
    const api = host(vi.fn());

    act(() => api().rowHandlers(0, 0).onDragStart());
    act(() => api().rowHandlers(0, 2).onDragEnter());
    act(() => api().rowHandlers(0, 0).onDragEnd());

    expect(api().isDragging).toBe(false);
    expect(api().rowHandlers(0, 2).isDropTarget).toBe(false);
  });

  it('clears the drag after a refused drop, so no row stays highlighted', () => {
    const api = host(vi.fn());

    act(() => api().rowHandlers(0, 1).onDragStart());
    act(() => api().rowHandlers(0, 1).onDrop());

    expect(api().isDragging).toBe(false);
  });
});
