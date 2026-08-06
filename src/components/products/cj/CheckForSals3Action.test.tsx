import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForSals3Candidate } from '@/app/(portal)/products/actions';
import CheckForSals3Action from './CheckForSals3Action';

vi.mock('@/app/(portal)/products/actions', () => ({
  checkForSals3Candidate: vi.fn(),
}));

const mockedCheck = checkForSals3Candidate as unknown as ReturnType<
  typeof vi.fn
>;

function renderAction() {
  return render(
    <CheckForSals3Action externalProductId="CJLY1" productName="Widget" />,
  );
}

describe('CheckForSals3Action', () => {
  beforeEach(() => {
    mockedCheck.mockReset();
  });

  it('starts as a "Check for Sals3" button', () => {
    renderAction();
    expect(
      screen.getByRole('button', { name: 'Check for Sals3' }),
    ).toBeInTheDocument();
  });

  it('shows Shortlisted and the real candidate id after a successful shortlist', async () => {
    mockedCheck.mockResolvedValue({
      ok: true,
      candidateId: '11111111-1111-4111-8111-111111111111',
      shortlistState: 'SHORTLISTED',
      reused: false,
      evidence: null,
    });

    renderAction();
    fireEvent.click(screen.getByRole('button', { name: 'Check for Sals3' }));

    await waitFor(() => {
      expect(screen.getByText('Shortlisted')).toBeInTheDocument();
    });
    expect(
      screen.getByText('11111111-1111-4111-8111-111111111111'),
    ).toBeInTheDocument();
  });

  it('never renders a preflight decision label, because preflight does not run', async () => {
    mockedCheck.mockResolvedValue({
      ok: true,
      candidateId: '11111111-1111-4111-8111-111111111111',
      shortlistState: 'SHORTLISTED',
      reused: false,
      evidence: null,
    });

    renderAction();
    fireEvent.click(screen.getByRole('button', { name: 'Check for Sals3' }));
    await waitFor(() => {
      expect(screen.getByText('Shortlisted')).toBeInTheDocument();
    });

    [
      'Ready',
      'Ready · Needs Attention',
      'Review Required',
      'On Hold',
      'Blocked',
    ].forEach((forbidden) => {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    });
  });

  it.each([
    ['denied', 'Your role cannot shortlist candidates.'],
    [
      'rate_limited',
      'Too many shortlist requests. Wait a moment and try again.',
    ],
    ['failed', 'Saving the candidate failed. Try again in a moment.'],
  ] as const)(
    'reports a %s failure honestly instead of showing success',
    async (reason, message) => {
      mockedCheck.mockResolvedValue({ ok: false, reason });

      renderAction();
      fireEvent.click(screen.getByRole('button', { name: 'Check for Sals3' }));

      await waitFor(() => {
        expect(screen.getByText('Not shortlisted')).toBeInTheDocument();
      });
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(screen.queryByText('Shortlisted')).not.toBeInTheDocument();
    },
  );

  it('calls the server action exactly once per click', async () => {
    mockedCheck.mockResolvedValue({ ok: false, reason: 'failed' });

    renderAction();
    fireEvent.click(screen.getByRole('button', { name: 'Check for Sals3' }));

    await waitFor(() => {
      expect(screen.getByText('Not shortlisted')).toBeInTheDocument();
    });
    expect(mockedCheck).toHaveBeenCalledTimes(1);
    expect(mockedCheck).toHaveBeenCalledWith('CJLY1');
  });
});
