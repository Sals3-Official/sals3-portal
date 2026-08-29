import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyMarginCsvAction: vi.fn(),
  refresh: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn() },
}));

vi.mock('@/app/(portal)/market-rules/pricing-actions', () => ({
  applyMarginCsvAction: mocks.applyMarginCsvAction,
}));

/* eslint-disable import/first */
import MarginCsvControls from './MarginCsvControls';
import type { CategoryMarginNodeViewModel } from './category-margin-model';

function node(
  overrides: Partial<CategoryMarginNodeViewModel> = {},
): CategoryMarginNodeViewModel {
  return {
    categoryId: 'id-1',
    code: 'CAT-GGL-1',
    path: 'Animals & Pet Supplies',
    name: 'Animals & Pet Supplies',
    depth: 1,
    parentPath: null,
    childCount: 0,
    subtreeCount: 124,
    policies: {},
    ...overrides,
  };
}

/** Two pilot lanes and Global — enough to prove one line per scope. */
const SCOPES = [
  { key: 'AU', label: 'Australia', marketCode: 'AU', isGlobal: false },
  { key: 'FJ', label: 'Fiji', marketCode: 'FJ', isGlobal: false },
  { key: 'GLOBAL', label: 'Global', marketCode: null, isGlobal: true },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MarginCsvControls', () => {
  /**
   * Shipped as "Export CSV" beside "Import CSV" and the owner asked for one
   * control: nobody uploads a file they did not first download, so two
   * buttons presented a sequence as a choice.
   */
  it('offers a single button, not a separate export and import', () => {
    render(<MarginCsvControls nodes={[node()]} canManage scopes={SCOPES} />);

    expect(
      screen.getByRole('button', { name: /Import \/ export/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import CSV' })).toBeNull();
  });

  it('opens a dialog that numbers the download before the upload', () => {
    render(<MarginCsvControls nodes={[node()]} canManage scopes={SCOPES} />);

    fireEvent.click(screen.getByRole('button', { name: /Import \/ export/ }));

    expect(screen.getByText('1. Download the file')).toBeInTheDocument();
    expect(screen.getByText('2. Upload the file')).toBeInTheDocument();
  });

  it('lets a read-only caller download, but never upload', () => {
    render(
      <MarginCsvControls nodes={[node()]} canManage={false} scopes={SCOPES} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Import \/ export/ }));

    expect(
      screen.getByRole('button', { name: /Download CSV/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('2. Upload the file')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply file' })).toBeNull();
  });

  it('refuses to apply until a file and a long enough reason are both present', () => {
    render(<MarginCsvControls nodes={[node()]} canManage scopes={SCOPES} />);

    fireEvent.click(screen.getByRole('button', { name: /Import \/ export/ }));

    // No file yet.
    expect(screen.getByRole('button', { name: 'Apply file' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Reason for change'), {
      target: { value: 'A reason long enough to pass.' },
    });

    // Reason alone is not enough either.
    expect(screen.getByRole('button', { name: 'Apply file' })).toBeDisabled();
  });

  it('counts the reason down as it is typed', () => {
    render(<MarginCsvControls nodes={[node()]} canManage scopes={SCOPES} />);

    fireEvent.click(screen.getByRole('button', { name: /Import \/ export/ }));
    fireEvent.change(screen.getByLabelText('Reason for change'), {
      target: { value: 'short' },
    });

    expect(
      screen.getByText(/Use 10 characters or more\. You have 5\./),
    ).toBeInTheDocument();
  });

  it('lists every rejected line and leaves the dialog open to fix them', async () => {
    mocks.applyMarginCsvAction.mockResolvedValue({
      ok: false,
      reason: 'invalid_input',
      rowErrors: ['Line 3: markup_percent "zzz" is not a number.'],
    });

    render(<MarginCsvControls nodes={[node()]} canManage scopes={SCOPES} />);

    fireEvent.click(screen.getByRole('button', { name: /Import \/ export/ }));

    const file = new File(
      ['category_code,markup_percent\nCAT-GGL-1,300'],
      'm.csv',
      {
        type: 'text/csv',
      },
    );
    fireEvent.change(screen.getByLabelText('File'), {
      target: { files: [file] },
    });
    fireEvent.change(screen.getByLabelText('Reason for change'), {
      target: { value: 'A reason long enough to pass.' },
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Apply file' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply file' }));

    expect(
      await screen.findByText(/markup_percent "zzz" is not a number/),
    ).toBeInTheDocument();
    // Still open, because the file has to be corrected and re-uploaded.
    expect(screen.getByText('2. Upload the file')).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('refreshes the page after a successful apply', async () => {
    mocks.applyMarginCsvAction.mockResolvedValue({
      ok: true,
      data: { written: 2, cleared: 1, unchanged: 5 },
    });

    render(<MarginCsvControls nodes={[node()]} canManage scopes={SCOPES} />);

    fireEvent.click(screen.getByRole('button', { name: /Import \/ export/ }));

    const file = new File(
      ['category_code,markup_percent\nCAT-GGL-1,300'],
      'm.csv',
      {
        type: 'text/csv',
      },
    );
    fireEvent.change(screen.getByLabelText('File'), {
      target: { files: [file] },
    });
    fireEvent.change(screen.getByLabelText('Reason for change'), {
      target: { value: 'A reason long enough to pass.' },
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Apply file' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply file' }));

    // The margins on screen come from the server, so without this the table
    // keeps showing the pre-upload rates until a manual reload.
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      '2 changed, 1 cleared, 5 already correct.',
    );
  });

  /**
   * A regression guard, and honest about being only that.
   *
   * The defect the owner reported on 2026-08-30 — "I have to refresh for the
   * change to show" — is a race between the write finishing and
   * `router.refresh()` re-rendering the 213-category tree. Measured against
   * their own 1,492-row file: the toast fired and the dialog closed in a few
   * seconds, and the table caught up 11–21 seconds later.
   *
   * The fix waits for the refresh transition before closing. It cannot be
   * pinned here: `refresh` is a synchronous mock, so the transition settles in
   * the same tick and the fixed and broken orderings are indistinguishable.
   * Reverting the fix leaves this file green, which is why this comment says so
   * rather than the test pretending otherwise. It was verified by measurement
   * against production, not by assertion.
   *
   * What this still holds is that the dialog does close on success at all.
   */
  it('closes once the import has been applied', async () => {
    mocks.applyMarginCsvAction.mockResolvedValue({
      ok: true,
      data: { written: 2, cleared: 1, unchanged: 5 },
    });
    render(<MarginCsvControls nodes={[node()]} canManage scopes={SCOPES} />);

    fireEvent.click(screen.getByRole('button', { name: /Import \/ export/ }));

    const file = new File(
      ['category_code,markup_percent\nCAT-GGL-1,300'],
      'markups.csv',
      { type: 'text/csv' },
    );
    fireEvent.change(screen.getByLabelText('File'), {
      target: { files: [file] },
    });
    fireEvent.change(screen.getByLabelText('Reason for change'), {
      target: { value: 'A reason long enough to pass.' },
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Apply file' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply file' }));

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());

    // And once the refresh settles, it lets go.
    await waitFor(() =>
      expect(screen.queryByLabelText('Reason for change')).toBeNull(),
    );
  });
});
