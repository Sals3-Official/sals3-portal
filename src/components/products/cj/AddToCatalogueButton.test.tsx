import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));

vi.mock('@/app/(portal)/listings/bulk-draft-action', () => ({
  default: actionMock,
}));
vi.mock('sonner', () => ({ toast: toastMock }));

/* eslint-disable import/first */
import PipelineSelectionProvider from './PipelineSelectionProvider';
import CandidateSelectCheckbox from './CandidateSelectCheckbox';
import AddToCatalogueButton from './AddToCatalogueButton';
/* eslint-enable import/first */

const CANDIDATE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CANDIDATE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function renderButton() {
  return render(
    <PipelineSelectionProvider>
      <CandidateSelectCheckbox
        candidateId={CANDIDATE_A}
        name="Product A"
        disabled={false}
      />
      <CandidateSelectCheckbox
        candidateId={CANDIDATE_B}
        name="Product B"
        disabled={false}
      />
      <AddToCatalogueButton />
    </PipelineSelectionProvider>,
  );
}

function selectBoth() {
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Product A' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Product B' }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AddToCatalogueButton', () => {
  it('is disabled with nothing selected and counts the selection', () => {
    renderButton();

    expect(
      screen.getByRole('button', { name: 'Add to Product Catalogue' }),
    ).toBeDisabled();

    selectBoth();

    expect(
      screen.getByRole('button', { name: 'Add 2 to Product Catalogue' }),
    ).toBeEnabled();
  });

  it('summarizes the outcome counts in a toast', async () => {
    actionMock.mockResolvedValue({
      ok: true,
      outcomes: [
        {
          candidateId: CANDIDATE_A,
          status: 'created',
          productId: 'product-a',
          missingRequirements: [],
        },
        { candidateId: CANDIDATE_B, status: 'already_in_catalogue' },
      ],
    });
    renderButton();
    selectBoth();

    fireEvent.click(
      screen.getByRole('button', { name: 'Add 2 to Product Catalogue' }),
    );

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        '1 added to your catalogue · 1 already there',
        expect.objectContaining({ description: expect.any(String) }),
      ),
    );
  });

  /** Failed rows stay selected, so the retry is one click. */
  it('keeps only the failed rows selected after a partial failure', async () => {
    actionMock.mockResolvedValue({
      ok: true,
      outcomes: [
        {
          candidateId: CANDIDATE_A,
          status: 'created',
          productId: 'product-a',
          missingRequirements: [],
        },
        { candidateId: CANDIDATE_B, status: 'failed', reason: 'failed' },
      ],
    });
    renderButton();
    selectBoth();

    fireEvent.click(
      screen.getByRole('button', { name: 'Add 2 to Product Catalogue' }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Add 1 to Product Catalogue' }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('checkbox', { name: 'Select Product B' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('checkbox', { name: 'Select Product A' }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  /**
   * The idempotency base must survive a whole-batch failure: a retry of the
   * same selection replays the same per-candidate keys instead of duplicating
   * whatever the timed-out attempt already created.
   */
  it('replays the same key base after a failure, rotates it after success', async () => {
    actionMock
      .mockResolvedValueOnce({ ok: false, reason: 'rate_limited' })
      .mockResolvedValueOnce({ ok: true, outcomes: [] })
      .mockResolvedValueOnce({ ok: true, outcomes: [] });
    renderButton();
    selectBoth();

    const button = screen.getByRole('button', {
      name: 'Add 2 to Product Catalogue',
    });

    fireEvent.click(button);
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    // The transition ends asynchronously; a click on a still-pending button is
    // ignored, so each retry must wait for the button to re-enable.
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(3));

    const bases = actionMock.mock.calls.map(
      ([input]) => (input as { idempotencyKeyBase: string }).idempotencyKeyBase,
    );

    expect(bases[0]).toBe(bases[1]);
    expect(bases[2]).not.toBe(bases[1]);
  });
});
