import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  beginMarketProfileSetupAction: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn() },
}));

vi.mock('@/app/(portal)/market-rules/market-profile-actions', () => ({
  beginMarketProfileSetupAction: mocks.beginMarketProfileSetupAction,
}));

/* eslint-disable import/first */
import BeginMarketProfileSetupDialog from './BeginMarketProfileSetupDialog';

const CHOICES = [
  { destinationCountryCode: 'AU', destinationName: 'Australia' },
  { destinationCountryCode: 'PH', destinationName: 'Philippines' },
];

function openDialog() {
  render(<BeginMarketProfileSetupDialog choices={CHOICES} />);
  fireEvent.click(screen.getByRole('button', { name: 'Set up a destination' }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BeginMarketProfileSetupDialog — accessibility', () => {
  it('gives every field a real label', async () => {
    openDialog();

    expect(await screen.findByLabelText('Destination')).toBeInTheDocument();
    expect(screen.getByLabelText('Business reason')).toBeInTheDocument();
  });

  it('names the dialog for assistive technology', async () => {
    openDialog();

    expect(
      await screen.findByRole('dialog', { name: /Set up a destination/ }),
    ).toBeInTheDocument();
  });

  it('announces a failure through an alert, not just colour', async () => {
    mocks.beginMarketProfileSetupAction.mockResolvedValue({
      ok: false,
      reason: 'destination_not_authorized',
    });

    openDialog();
    fireEvent.change(await screen.findByLabelText('Business reason'), {
      target: { value: 'Opening this destination for the pilot.' },
    });
    fireEvent.change(screen.getByLabelText('Destination'), {
      target: { value: 'AU' },
    });

    // Submitting via the form keeps the keyboard path under test rather than
    // relying on a pointer-only interaction.
    fireEvent.submit(screen.getByLabelText('Business reason').closest('form')!);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/not currently approved/);
  });

  it('keeps the submit control disabled until a destination is chosen', async () => {
    openDialog();

    expect(
      await screen.findByRole('button', { name: 'Start setup' }),
    ).toBeDisabled();
  });
});

describe('BeginMarketProfileSetupDialog — behaviour', () => {
  it('offers only the destinations it was given', async () => {
    openDialog();

    const select = await screen.findByLabelText('Destination');
    expect(select).toBeInTheDocument();
    // 'SG' was never offered, so it cannot be picked from the UI at all.
    expect(screen.queryByText(/Singapore/)).not.toBeInTheDocument();
  });

  it('submits only a destination and a reason — never a seller identity', async () => {
    mocks.beginMarketProfileSetupAction.mockResolvedValue({ ok: true });

    openDialog();
    fireEvent.change(await screen.findByLabelText('Business reason'), {
      target: { value: 'Opening this destination for the pilot.' },
    });
    fireEvent.submit(screen.getByLabelText('Business reason').closest('form')!);

    await waitFor(() => {
      expect(mocks.beginMarketProfileSetupAction).toHaveBeenCalled();
    });

    // The whole payload, so a seller/owner field could not be added later
    // without this failing. Tenant identity comes from the session only.
    const payload = mocks.beginMarketProfileSetupAction.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual([
      'destinationCountryCode',
      'reason',
    ]);
    expect(payload.reason).toBe('Opening this destination for the pilot.');
  });

  it('confirms success and refreshes the page', async () => {
    mocks.beginMarketProfileSetupAction.mockResolvedValue({ ok: true });

    openDialog();
    fireEvent.change(await screen.findByLabelText('Business reason'), {
      target: { value: 'Opening this destination for the pilot.' },
    });
    fireEvent.submit(screen.getByLabelText('Business reason').closest('form')!);

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Destination setup started.',
      );
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('explains a concurrent setup instead of failing silently', async () => {
    mocks.beginMarketProfileSetupAction.mockResolvedValue({
      ok: false,
      reason: 'conflict',
    });

    openDialog();
    fireEvent.change(await screen.findByLabelText('Destination'), {
      target: { value: 'AU' },
    });
    fireEvent.change(screen.getByLabelText('Business reason'), {
      target: { value: 'Opening this destination for the pilot.' },
    });
    fireEvent.submit(screen.getByLabelText('Business reason').closest('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /already being set up/,
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
