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
  it('shows each destination its own reserve, in the form it was set', () => {
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
    expect(screen.getByText('21.95%')).toBeInTheDocument();
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
    expect(screen.getAllByText('None').length).toBeGreaterThan(0);
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

    fireEvent.change(screen.getByLabelText('Minimum markup percent for Fiji'), {
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
      screen.getByLabelText('Minimum markup percent for Fiji'),
    ).toBeDisabled();
  });

  it('sends the destination that was clicked, and only one floor form', async () => {
    mocks.saveStoreDefaultAction.mockResolvedValue({ ok: true });

    openFiji();

    fireEvent.change(screen.getByLabelText('Minimum markup percent for Fiji'), {
      target: { value: '18' },
    });
    fireEvent.change(screen.getByLabelText('Reason for change to Fiji'), {
      target: { value: 'Fiji freight is four times the PH lane.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mocks.saveStoreDefaultAction).toHaveBeenCalledWith({
        // No `targetMarginRate`. The dialog no longer carries a base markup and
        // the action writes null — asserted as an exact payload rather than
        // `objectContaining`, so a field creeping back in fails here.
        //
        // The unused floor form goes out as its own "absent" value, not as a
        // second floor — `0` for the amount column, `null` for the rate column.
        // Sending both would be refused by the database constraint.
        minContribution: '0',
        // 18 is a markup, so the stored margin rate is 18/118.
        minContributionRate: '0.152542',
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

    fireEvent.change(
      screen.getByLabelText('Minimum markup percent for Global'),
      { target: { value: '30' } },
    );
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
  /**
   * The two percentage fields in this dialog have different bases, and nothing
   * said so: `Base markup` is a share of the **cost**, the reserve is a share
   * of the **selling price**. The owner read them as the same unit and would
   * have entered 50 where 33.33 was meant — a floor of US$2.00 on a US$1.00
   * cost instead of US$1.50.
   *
   * The hint restates the entry in the other unit, live, which is cheaper than
   * a paragraph nobody reads.
   */
  /**
   * The reserve used to be a share of the selling price while the field above
   * it was a share of the cost. Two bases on one dialog, nothing saying which
   * was which — so `50` got typed where `33.33` was meant, and the owner read
   * the whole screen as unintelligible.
   *
   * Both are markups now. The bridge hint that translated between them is gone
   * with the gap it was bridging.
   */
  describe('one unit on the whole dialog', () => {
    async function openAustralia() {
      render(
        <StoreDefaultsTable scopes={SCOPES} storeDefaults={{}} canManage />,
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Set store default for Australia' }),
      );

      return screen.findByLabelText(/Minimum markup percent for Australia/);
    }

    it('labels the reserve as a markup, like the field above it', async () => {
      await openAustralia();

      expect(screen.getByText('As a markup')).toBeInTheDocument();
      expect(screen.queryByText(/share of the selling price/)).toBeNull();
    });

    it('no longer translates between units, because there is one', async () => {
      const field = await openAustralia();

      fireEvent.change(field, { target: { value: '50' } });

      // The hint read "Same as N% over cost — …". It has no job now.
      expect(screen.queryByText(/Same as .* over cost/)).toBeNull();
    });

    it('accepts a markup past 100, which the old margin field refused', async () => {
      // 150% is an ordinary markup and was previously impossible to enter here.
      const field = await openAustralia();

      fireEvent.change(field, { target: { value: '150' } });

      expect(field).toHaveValue(150);
    });
  });
});
