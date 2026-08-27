import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveStoreDefaultAction: vi.fn(),
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
  saveStoreDefaultAction: mocks.saveStoreDefaultAction,
}));

/* eslint-disable import/first */
import StoreDefaultsTable from './StoreDefaultsTable';
import type { StoreDefaultViewModel } from './store-default-model';

/** Two named lanes and Global, which is a row here like any other. */
const SCOPES = [
  { key: 'AU', label: 'Australia', marketCode: 'AU', isGlobal: false },
  { key: 'FJ', label: 'Fiji', marketCode: 'FJ', isGlobal: false },
  { key: 'GLOBAL', label: 'Global', marketCode: null, isGlobal: true },
];

function storeDefault(
  overrides: Partial<StoreDefaultViewModel> = {},
): StoreDefaultViewModel {
  return {
    id: 'default-1',
    targetMarginRate: '0.250000',
    minContributionMinor: 0,
    minContributionCurrency: 'USD',
    minContributionRate: null,
    roundingRule: 'NONE',
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StoreDefaultsTable', () => {
  it('shows each destination its own base margin and minimum', () => {
    render(
      <StoreDefaultsTable
        scopes={SCOPES}
        storeDefaults={{
          AU: storeDefault({ minContributionRate: '0.180000' }),
          FJ: storeDefault({ minContributionMinor: 400 }),
        }}
        canManage
      />,
    );

    // The two forms render as what they are — a percentage and an amount — so
    // the row says which kind of minimum is in force without a legend.
    expect(screen.getByText('18%')).toBeInTheDocument();
    expect(screen.getByText('US$4.00')).toBeInTheDocument();
  });

  it('says None rather than zero when a destination has no minimum', () => {
    render(
      <StoreDefaultsTable
        scopes={SCOPES}
        storeDefaults={{ AU: storeDefault(), FJ: null }}
        canManage
      />,
    );

    // `0` reads as a configured floor of nothing. "None" is the honest word for
    // a rule that was never set.
    expect(screen.getAllByText('None').length).toBeGreaterThan(0);
  });

  it('offers Set where no rule exists and Edit where one does', () => {
    render(
      <StoreDefaultsTable
        scopes={SCOPES}
        storeDefaults={{ AU: storeDefault(), FJ: null }}
        canManage
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Edit store default for Australia' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Set store default for Fiji' }),
    ).toBeInTheDocument();
  });

  /**
   * Global is a scope, so it is a row — owner decision 2026-08-27. Nothing in
   * this component knows about it; it arrives in `scopes` and iterates like the
   * rest.
   */
  it('gives Global a row of its own, named in words', () => {
    render(
      <StoreDefaultsTable
        scopes={SCOPES}
        storeDefaults={{ AU: storeDefault(), FJ: null, GLOBAL: null }}
        canManage
      />,
    );

    expect(screen.getByText('Global')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Set store default for Global' }),
    ).toBeInTheDocument();
  });

  it('read-only callers get no editing controls', () => {
    render(
      <StoreDefaultsTable
        scopes={SCOPES}
        storeDefaults={{ AU: storeDefault(), FJ: null }}
        canManage={false}
      />,
    );

    expect(screen.queryByRole('button', { name: /store default/ })).toBeNull();
    // The values stay readable — read-only is not blank.
    expect(screen.getByText('25%')).toBeInTheDocument();
  });
});

describe('the minimum is one choice, not two fields', () => {
  function openFiji() {
    render(
      <StoreDefaultsTable
        scopes={SCOPES}
        storeDefaults={{ AU: null, FJ: null }}
        canManage
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Set store default for Fiji' }),
    );
  }

  it('disables the amount once a percentage is typed', () => {
    openFiji();

    fireEvent.change(screen.getByLabelText('Minimum margin percent for Fiji'), {
      target: { value: '18' },
    });

    // Disabled, not merely ignored. A form that silently drops what someone
    // typed is how people learn not to trust a screen.
    expect(
      screen.getByLabelText('Minimum contribution amount for Fiji'),
    ).toBeDisabled();
  });

  it('disables the percentage once an amount is typed', () => {
    openFiji();

    fireEvent.change(
      screen.getByLabelText('Minimum contribution amount for Fiji'),
      { target: { value: '4.00' } },
    );

    expect(
      screen.getByLabelText('Minimum margin percent for Fiji'),
    ).toBeDisabled();
  });

  it('sends the destination that was clicked, and only one floor form', async () => {
    mocks.saveStoreDefaultAction.mockResolvedValue({ ok: true });

    openFiji();

    fireEvent.change(screen.getByLabelText('Base margin percent for Fiji'), {
      target: { value: '25' },
    });
    fireEvent.change(screen.getByLabelText('Minimum margin percent for Fiji'), {
      target: { value: '18' },
    });
    fireEvent.change(screen.getByLabelText('Reason for change to Fiji'), {
      target: { value: 'Fiji freight is four times the PH lane.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mocks.saveStoreDefaultAction).toHaveBeenCalledWith({
        targetMarginRate: '0.25',
        // The unused form goes out as its own "absent" value, not as a second
        // floor — `0` for the amount column, `null` for the rate column. Sending
        // both would be refused by the database constraint.
        minContribution: '0',
        minContributionRate: '0.18',
        roundingRule: 'NONE',
        marketCode: 'FJ',
        reason: 'Fiji freight is four times the PH lane.',
      }),
    );
  });
});

describe('Global writes the null market code, never its column key', () => {
  /**
   * `'GLOBAL'` is the name this scope has on screen and nowhere else.
   * `pricing_store_defaults.market_code` is a country code or `NULL`, and the
   * action's own schema refuses anything that is neither — so sending the key
   * would fail the save outright, and sending a country code would quietly
   * price the wrong one.
   */
  it('sends marketCode: null when the Global row is edited', async () => {
    mocks.saveStoreDefaultAction.mockResolvedValue({ ok: true });

    render(
      <StoreDefaultsTable
        scopes={SCOPES}
        storeDefaults={{ AU: null, FJ: null, GLOBAL: null }}
        canManage
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Set store default for Global' }),
    );

    fireEvent.change(screen.getByLabelText('Base margin percent for Global'), {
      target: { value: '30' },
    });
    fireEvent.change(screen.getByLabelText('Reason for change to Global'), {
      target: { value: 'Everywhere we have not measured freight for yet.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mocks.saveStoreDefaultAction).toHaveBeenCalledWith(
        expect.objectContaining({ marketCode: null }),
      ),
    );
  });
});
