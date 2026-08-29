import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  previewRepriceAction: vi.fn(),
  applyRepriceAction: vi.fn(),
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
  previewRepriceAction: mocks.previewRepriceAction,
  applyRepriceAction: mocks.applyRepriceAction,
}));

/* eslint-disable import/first */
import RepriceControls from './RepriceControls';

function previewLine(overrides: Record<string, unknown> = {}) {
  return {
    offerId: 'offer-1',
    productTitle: 'Corduroy jacket',
    sku: 'SALS3-1',
    marketCode: 'AU',
    status: 'CHANGED',
    currentPriceMinor: 2399,
    currentPriceCurrency: 'USD',
    newPriceMinor: 2999,
    newPriceCurrency: 'USD',
    reasonLabel: null,
    ...overrides,
  };
}

function preview(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      counts: { changed: 1, unchanged: 4, unpriceable: 0, manual: 0 },
      truncated: false,
      candidateCount: 5,
      nextAfterSku: null,
      fingerprint: '1-abc',
      lines: [previewLine()],
      ...overrides,
    },
  };
}

const REASON = 'Supplier costs rose across the department.';

/** Two departments and three columns; the component's job is the wiring, not the count. */
const CATEGORIES = [
  { code: 'CAT-GGL-166', name: 'Apparel & Accessories' },
  { code: 'CAT-GGL-436', name: 'Home & Garden' },
];

const SCOPES = [
  { key: 'AU', label: 'Australia', marketCode: 'AU' },
  { key: 'FJ', label: 'Fiji', marketCode: 'FJ' },
  { key: 'GLOBAL', label: 'Global', marketCode: null },
];

function renderControls(canManage = true) {
  return render(
    <RepriceControls
      canManage={canManage}
      categories={CATEGORIES}
      scopes={SCOPES}
    />,
  );
}

/** Opens the dialog and picks a scope, without checking anything yet. */
function openAndScope(categoryCode = 'CAT-GGL-166', scopeKey: string = 'AU') {
  fireEvent.click(
    screen.getByRole('button', { name: /Reprice live products/ }),
  );
  fireEvent.change(screen.getByLabelText('Category'), {
    target: { value: categoryCode },
  });
  fireEvent.change(screen.getByLabelText('Destination'), {
    target: { value: scopeKey },
  });
}

/**
 * Presses Check once the previous press has finished.
 *
 * `openAndCheck` waits for the preview text, which appears while the
 * `useTransition` is still pending — the button still reads "Checking…" at that
 * moment, so a second press aimed at its idle label finds nothing.
 */
async function checkAgain() {
  fireEvent.click(
    await screen.findByRole('button', { name: /Check what would change/ }),
  );
}

async function openAndCheck() {
  openAndScope();
  fireEvent.click(
    screen.getByRole('button', { name: /Check what would change/ }),
  );
  await screen.findByText(/1 price moves/);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.previewRepriceAction.mockResolvedValue(preview());
  mocks.applyRepriceAction.mockResolvedValue({
    ok: true,
    data: { written: 1, unchanged: 4, unpriceable: 0, manual: 0 },
  });
});

describe('RepriceControls', () => {
  /**
   * The guard the whole dialog exists for: a live price must never move
   * because somebody opened a dialog and typed a sentence.
   */
  it('cannot apply anything before the seller has looked', () => {
    renderControls();

    fireEvent.click(
      screen.getByRole('button', { name: /Reprice live products/ }),
    );

    expect(
      screen.queryByRole('button', { name: 'Apply new prices' }),
    ).toBeDisabled();
    expect(screen.queryByLabelText('Reason for change')).toBeNull();
  });

  /**
   * The defect this replaced, and the reason a scope is required rather than
   * optional.
   *
   * The unscoped run selected every published offer this seller owned, ordered
   * by title, and took the first 500 — no cursor, and no exclusion of the rows
   * it had already found correct, so it returned the *same* 500 forever and
   * everything past the 500th product alphabetically was unreachable. On a
   * catalogue heading for millions of listings the repair is not a bigger cap;
   * it is never offering "everything" in the first place.
   */
  it('will not check anything until a scope is chosen', () => {
    renderControls();

    fireEvent.click(
      screen.getByRole('button', { name: /Reprice live products/ }),
    );

    expect(
      screen.getByRole('button', { name: /Check what would change/ }),
    ).toBeDisabled();
  });

  it('still refuses with only half a scope', () => {
    // A department with no destination would price Australia's offers with
    // Fiji's rule as readily as its own — the half-filled state has to be as
    // refused as the empty one.
    renderControls();

    fireEvent.click(
      screen.getByRole('button', { name: /Reprice live products/ }),
    );
    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: 'CAT-GGL-166' },
    });

    expect(
      screen.getByRole('button', { name: /Check what would change/ }),
    ).toBeDisabled();
  });

  it('sends All categories as a null category, not a sentinel string', async () => {
    /*
      `'ALL'` is a value a `<select>` can carry; it is not a category code. The
      engine reads `null` as "no category filter", and a sentinel reaching it
      would resolve no category and price nothing while reporting success.
    */
    renderControls();

    openAndScope('ALL', 'AU');
    fireEvent.click(
      screen.getByRole('button', { name: /Check what would change/ }),
    );
    await screen.findByText(/1 price moves/);

    expect(mocks.previewRepriceAction).toHaveBeenCalledWith(
      { categoryCode: null, marketCode: 'AU', afterSku: null },
      false,
    );
  });

  it('keeps "nothing chosen" apart from "all categories"', async () => {
    // Both become `null` on the wire, so the empty string has to stay the
    // unchosen state — otherwise opening the dialog would look like a choice.
    renderControls();

    fireEvent.click(
      screen.getByRole('button', { name: /Reprice live products/ }),
    );
    fireEvent.change(screen.getByLabelText('Destination'), {
      target: { value: 'AU' },
    });

    expect(
      screen.getByRole('button', { name: /Check what would change/ }),
    ).toBeDisabled();
  });

  it('sends Global as a null market rather than its column key', async () => {
    // `'GLOBAL'` is the name this scope has on screen and nowhere else.
    // `market_code` is a country code or NULL, and the engine reads null as
    // "every destination without a rule of its own".
    renderControls();

    openAndScope('CAT-GGL-436', 'GLOBAL');
    fireEvent.click(
      screen.getByRole('button', { name: /Check what would change/ }),
    );
    await screen.findByText(/1 price moves/);

    expect(mocks.previewRepriceAction).toHaveBeenCalledWith(
      { categoryCode: 'CAT-GGL-436', marketCode: null, afterSku: null },
      false,
    );
  });

  it('drops a preview when the scope changes underneath it', async () => {
    /*
      Same discipline the reclaim checkbox already had. A list checked for
      Apparel does not describe a run against Home & Garden, and leaving it on
      screen would put an approved-looking table above a button that would write
      something else. The fingerprint would refuse it, but only after the click.
    */
    renderControls();
    await openAndCheck();

    expect(screen.getByText('Corduroy jacket')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: 'CAT-GGL-436' },
    });

    expect(screen.queryByText('Corduroy jacket')).toBeNull();
  });

  it('does not move its position just because a page was looked at', async () => {
    /*
      Checking writes nothing, so it must not advance either. A seller who reads
      a page and walks away has covered nothing; resuming past it would leave a
      silent hole exactly where they stopped paying attention.
    */
    mocks.previewRepriceAction.mockResolvedValue(
      preview({ truncated: true, nextAfterSku: 'SKU-0499' }),
    );
    renderControls();

    await openAndCheck();
    await checkAgain();

    await waitFor(() =>
      expect(mocks.previewRepriceAction).toHaveBeenLastCalledWith(
        { categoryCode: 'CAT-GGL-166', marketCode: 'AU', afterSku: null },
        false,
      ),
    );
  });

  it('continues from where an applied page ended', async () => {
    mocks.previewRepriceAction.mockResolvedValue(
      preview({ truncated: true, nextAfterSku: 'SKU-0499' }),
    );
    renderControls();

    await openAndCheck();
    fireEvent.change(screen.getByLabelText('Reason for change'), {
      target: { value: REASON },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply new prices' }));

    /*
      Waited on the SCREEN, not on the refresh mock.

      `refresh` having been called says the apply reached its success path; it
      says nothing about the new position having been flushed into the render
      the next click reads. Waiting for the notice is waiting for the state
      itself, and it is the difference between this case passing reliably and
      passing whenever the scheduler happens to cooperate.
    */
    await screen.findByText(/Continuing from where the last run stopped/);

    await checkAgain();

    await waitFor(() =>
      expect(mocks.previewRepriceAction).toHaveBeenLastCalledWith(
        { categoryCode: 'CAT-GGL-166', marketCode: 'AU', afterSku: 'SKU-0499' },
        false,
      ),
    );
  });

  it('starts a different department from the beginning again', async () => {
    // A position in one department means nothing in another, and carrying it
    // over would skip whatever sorts before it in the new one.
    mocks.previewRepriceAction.mockResolvedValue(
      preview({ truncated: true, nextAfterSku: 'SKU-0499' }),
    );
    renderControls();

    await openAndCheck();
    fireEvent.change(screen.getByLabelText('Reason for change'), {
      target: { value: REASON },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply new prices' }));
    // Same reason as above: the notice is the position, the mock is only the call.
    await screen.findByText(/Continuing from where the last run stopped/);

    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: 'CAT-GGL-436' },
    });
    await checkAgain();

    await waitFor(() =>
      expect(mocks.previewRepriceAction).toHaveBeenLastCalledWith(
        { categoryCode: 'CAT-GGL-436', marketCode: 'AU', afterSku: null },
        false,
      ),
    );
  });

  it('says so on screen when it is continuing rather than starting over', async () => {
    // Otherwise a seller presses Check twice and quietly compares two different
    // pages while believing they are the same one.
    mocks.previewRepriceAction.mockResolvedValue(
      preview({ truncated: true, nextAfterSku: 'SKU-0499' }),
    );
    renderControls();

    await openAndCheck();
    expect(screen.queryByText(/Continuing from where/)).toBeNull();

    fireEvent.change(screen.getByLabelText('Reason for change'), {
      target: { value: REASON },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply new prices' }));

    expect(
      await screen.findByText(/Continuing from where the last run stopped/),
    ).toBeInTheDocument();
  });

  it('shows what each price is now and what it becomes', async () => {
    renderControls();

    await openAndCheck();

    expect(screen.getByText('Corduroy jacket')).toBeInTheDocument();
    expect(screen.getByText('$23.99')).toBeInTheDocument();
    expect(screen.getByText('$29.99')).toBeInTheDocument();
  });

  it('checking writes nothing', async () => {
    renderControls();

    await openAndCheck();

    expect(mocks.applyRepriceAction).not.toHaveBeenCalled();
  });

  it('still refuses to apply until a reason is written', async () => {
    renderControls();

    await openAndCheck();

    expect(
      screen.getByRole('button', { name: 'Apply new prices' }),
    ).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Reason for change'), {
      target: { value: 'short' },
    });

    expect(
      screen.getByRole('button', { name: 'Apply new prices' }),
    ).toBeDisabled();
  });

  it('sends the digest of the plan it showed, and the reason', async () => {
    renderControls();

    await openAndCheck();
    fireEvent.change(screen.getByLabelText('Reason for change'), {
      target: { value: REASON },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply new prices' }));

    await waitFor(() =>
      expect(mocks.applyRepriceAction).toHaveBeenCalledWith({
        fingerprint: '1-abc',
        reason: REASON,
        // An ordinary run leaves hand-typed prices alone.
        reclaimSellerPriced: false,
        // Re-sent so the server can refuse an apply that names a different
        // scope than the preview — two empty plans share a fingerprint.
        scope: {
          categoryCode: 'CAT-GGL-166',
          marketCode: 'AU',
          afterSku: null,
        },
      }),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  /**
   * A stale list is cleared, not left on screen looking approved — the
   * numbers it shows are no longer the numbers that would be written.
   */
  it('clears the list and says so when the prices moved underneath it', async () => {
    mocks.applyRepriceAction.mockResolvedValue({
      ok: false,
      reason: 'stale_preview',
    });
    renderControls();

    await openAndCheck();
    fireEvent.change(screen.getByLabelText('Reason for change'), {
      target: { value: REASON },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply new prices' }));

    expect(
      await screen.findByText(/Prices moved while this list was open/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Corduroy jacket')).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('names the products it could not price and says they keep their old price', async () => {
    mocks.previewRepriceAction.mockResolvedValue(
      preview({
        counts: { changed: 1, unchanged: 0, unpriceable: 1, manual: 0 },
        lines: [
          previewLine(),
          previewLine({
            offerId: 'offer-2',
            productTitle: 'Wool scarf',
            status: 'UNPRICEABLE',
            newPriceMinor: null,
            newPriceCurrency: null,
            reasonLabel: 'Supplier cost unavailable',
          }),
        ],
      }),
    );
    renderControls();

    await openAndCheck();

    expect(screen.getByText('Wool scarf')).toBeInTheDocument();
    expect(screen.getByText('Supplier cost unavailable')).toBeInTheDocument();
    expect(screen.getByText(/1 that cannot be priced/)).toBeInTheDocument();
  });

  it('shows a hand-typed price as kept rather than as a change', async () => {
    mocks.previewRepriceAction.mockResolvedValue(
      preview({
        counts: { changed: 1, unchanged: 0, unpriceable: 0, manual: 1 },
        lines: [
          previewLine(),
          previewLine({
            offerId: 'offer-3',
            productTitle: 'Linen shirt',
            status: 'MANUAL',
            newPriceMinor: null,
            newPriceCurrency: null,
          }),
        ],
      }),
    );
    renderControls();

    await openAndCheck();

    expect(screen.getByText('Kept — priced by hand')).toBeInTheDocument();
    expect(
      screen.getByText(/1 priced by hand and left alone/),
    ).toBeInTheDocument();
  });

  /**
   * A silent cap reads as "everything is up to date" when it is not — and the
   * copy this replaced was worse than silent. It said "run it again afterwards
   * to reach the rest", which could not work: nothing excluded the rows already
   * seen, so a second run returned the same page forever. On 2026-08-30 a
   * reclaim of Apparel & Accessories in AU covered 500 offers, left whatever sat
   * beyond them untouched, and then reported that every live price matched the
   * rules.
   */
  it('says when the run could not cover every product', async () => {
    mocks.previewRepriceAction.mockResolvedValue(preview({ truncated: true }));
    renderControls();

    await openAndCheck();

    expect(
      screen.getByText(/holds more than 500 live prices in this destination/),
    ).toBeInTheDocument();
  });

  it('lets a read-only caller look, but never apply', async () => {
    renderControls(false);

    // Scoped like any other run: looking is still scoped, and a read-only
    // caller who could check without choosing would be running the unscoped
    // query this change exists to remove.
    openAndScope();
    fireEvent.click(
      screen.getByRole('button', { name: /Check what would change/ }),
    );
    await screen.findByText(/1 price moves/);

    expect(screen.queryByLabelText('Reason for change')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Apply new prices' }),
    ).toBeNull();
  });
  /**
   * Taking back prices a person typed is the one run here that overwrites a
   * decision rather than a computation, so it is gated on typing the count the
   * preview reported — a number that cannot be supplied without reading it.
   *
   * Deliberately not a password: a password proves who is pressing, and what
   * needed proving is that they know what it will do.
   */
  describe('taking back hand-typed prices', () => {
    async function openWithReclaim() {
      openAndScope();
      fireEvent.click(
        screen.getByRole('checkbox', {
          name: /Also take back prices I typed by hand/,
        }),
      );
      fireEvent.click(
        screen.getByRole('button', { name: /Check what would change/ }),
      );
      await screen.findByText(/1 price moves/);
    }

    it('asks the server for a plan that includes them', async () => {
      renderControls();
      await openWithReclaim();

      expect(mocks.previewRepriceAction).toHaveBeenCalledWith(
        { categoryCode: 'CAT-GGL-166', marketCode: 'AU', afterSku: null },
        true,
      );
    });

    it('leaves them out by default', async () => {
      renderControls();
      await openAndCheck();

      expect(mocks.previewRepriceAction).toHaveBeenCalledWith(
        { categoryCode: 'CAT-GGL-166', marketCode: 'AU', afterSku: null },
        false,
      );
    });

    it('refuses to apply until the count is typed back', async () => {
      renderControls();
      await openWithReclaim();

      fireEvent.change(screen.getByLabelText('Reason for change'), {
        target: { value: REASON },
      });

      expect(
        screen.getByRole('button', { name: /Apply new prices/ }),
      ).toBeDisabled();

      fireEvent.change(screen.getByLabelText(/Type 1 to confirm/), {
        target: { value: '2' },
      });

      // A number, but the wrong one: reading is the point, not typing.
      expect(
        screen.getByRole('button', { name: /Apply new prices/ }),
      ).toBeDisabled();

      fireEvent.change(screen.getByLabelText(/Type 1 to confirm/), {
        target: { value: '1' },
      });

      expect(
        screen.getByRole('button', { name: /Apply new prices/ }),
      ).toBeEnabled();
    });

    it('discards a preview checked under the other setting', async () => {
      // A plan checked without the reclaim does not describe the run this would
      // perform. The fingerprint would refuse it; this says so before the click.
      renderControls();
      await openAndCheck();

      fireEvent.click(
        screen.getByRole('checkbox', {
          name: /Also take back prices I typed by hand/,
        }),
      );

      expect(screen.queryByText(/1 price moves/)).toBeNull();
    });
  });
});
