import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => vi.fn());

vi.mock('sonner', () => ({ toast: toastMock }));

/* eslint-disable import/first */
import PipelineSelectionProvider, {
  usePipelineSelection,
} from './PipelineSelectionProvider';
import CandidateSelectCheckbox from './CandidateSelectCheckbox';
import SelectAllOnPageCheckbox from './SelectAllOnPageCheckbox';
/* eslint-enable import/first */

function SelectionCount() {
  const { selected } = usePipelineSelection();

  return <output aria-label="selection count">{selected.size}</output>;
}

function renderSelection(eligibleIds: string[], disabledId?: string) {
  return render(
    <PipelineSelectionProvider>
      <SelectAllOnPageCheckbox eligibleIds={eligibleIds} />
      {eligibleIds.map((id) => (
        <CandidateSelectCheckbox
          key={id}
          candidateId={id}
          name={`Product ${id}`}
          disabled={false}
        />
      ))}
      {disabledId === undefined ? null : (
        <CandidateSelectCheckbox
          candidateId={disabledId}
          name={`Product ${disabledId}`}
          disabled
        />
      )}
      <SelectionCount />
    </PipelineSelectionProvider>,
  );
}

function count() {
  return screen.getByLabelText('selection count').textContent;
}

describe('pipeline selection', () => {
  it('toggles one row on and off', () => {
    renderSelection(['a']);

    const checkbox = screen.getByRole('checkbox', { name: 'Select Product a' });

    fireEvent.click(checkbox);
    expect(count()).toBe('1');
    fireEvent.click(checkbox);
    expect(count()).toBe('0');
  });

  /** Select-all receives only ELIGIBLE ids - a disabled row can never enter. */
  it('select-all selects every eligible row and never the disabled one', () => {
    renderSelection(['a', 'b'], 'drafted');

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select every candidate on this page not yet in the catalogue',
      }),
    );

    expect(count()).toBe('2');
    expect(
      screen.getByRole('checkbox', {
        name: 'Product drafted is already in the catalogue',
      }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('select-all toggles back to clear', () => {
    renderSelection(['a', 'b']);

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select every candidate on this page not yet in the catalogue',
      }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Clear the selection on this page',
      }),
    );

    expect(count()).toBe('0');
  });

  /** The cap: 100 = MAX_BULK_DRAFT_CANDIDATES = PIPELINE_PAGE_SIZE. */
  it('caps the selection at 100 and says so', () => {
    const ids = Array.from({ length: 101 }, (_, index) => `id-${index}`);

    renderSelection(ids);
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select every candidate on this page not yet in the catalogue',
      }),
    );

    expect(count()).toBe('100');
    expect(toastMock).toHaveBeenCalledWith(
      'You can add up to 100 products at once.',
    );
  });
});
