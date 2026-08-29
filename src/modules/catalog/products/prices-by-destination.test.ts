// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveProductPricingMock, displayFxRatesMock } = vi.hoisted(() => ({
  resolveProductPricingMock: vi.fn(),
  displayFxRatesMock: vi.fn(),
}));

vi.mock('@/modules/pricing/resolver', () => ({
  resolveProductPricing: resolveProductPricingMock,
}));

vi.mock('@/lib/portal/display-fx', () => ({ default: displayFxRatesMock }));

vi.mock('@/modules/pricing/pricing-scope-destinations', () => ({
  listPricingScopeDestinations: () => [
    { code: 'AU', label: 'Australia' },
    { code: 'US', label: 'United States' },
    { code: 'FJ', label: 'Fiji' },
  ],
}));

/* eslint-disable import/first */
import pricesByDestination from './prices-by-destination';

/**
 * The local figures here are APPROXIMATE and are never what anybody is charged
 * — ADR-003 phase 1 charges USD in every market. That framing is the whole
 * reason this is allowed to exist beside `modules/pricing/reference-fx.ts`,
 * which refuses every non-identity pair because no provider is approved for
 * what the Portal charges.
 *
 * So the cases that matter are the ones where a wrong number would look like a
 * right one.
 */

const SELLER_ID = '11111111-1111-4111-a111-111111111111';
const VARIANT_ID = '22222222-2222-4222-a222-222222222222';

function variantRow() {
  return {
    productId: 'product-1',
    categoryCode: 'CAT-GGL-166',
    categoryConfidence: 'EXACT',
    supplierCandidateId: 'candidate-1',
    supplierVariantId: 'cj-variant-1',
    costMinor: 486,
    costCurrency: 'USD',
    observedAt: new Date('2026-08-28T00:00:00.000Z'),
  };
}

function fakeDb(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const self = (): unknown => builder;

  ['select', 'from', 'innerJoin', 'leftJoin', 'where', 'limit'].forEach(
    (name) => {
      builder[name] = vi.fn(self);
    },
  );
  builder.then = (resolve: (value: unknown) => unknown) => resolve(rows);

  return { select: vi.fn(() => builder) };
}

function priced(amountMinor: number) {
  return {
    outcome: 'PRODUCT_MARGIN_ESTIMATE',
    roundedSuggestedItemPrice: { amountMinor, currency: 'USD' },
  };
}

async function run() {
  return pricesByDestination(fakeDb([variantRow()]) as never, {
    sellerAccountId: SELLER_ID,
    variantId: VARIANT_ID,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveProductPricingMock.mockResolvedValue(priced(2070));
  displayFxRatesMock.mockResolvedValue({ AUD: 1.39, FJD: 2.195 });
});

describe('pricesByDestination', () => {
  it('converts to the currency each destination thinks in', async () => {
    const rows = (await run()) ?? [];
    const au = rows.find((row) => row.marketCode === 'AU');

    // 2070 x 1.39 = 2877.3, rounded to the minor unit.
    expect(au?.approximateLocal).toEqual({
      amountMinor: 2877,
      currency: 'AUD',
    });
    // And the charged figure is untouched beside it.
    expect(au?.price).toEqual({ amountMinor: 2070, currency: 'USD' });
  });

  it('never converts a destination that already thinks in USD', async () => {
    /*
      `null` rather than a 1:1 conversion, so the screen can tell "nothing to
      convert" from "converted, and it came out the same". Rendering `≈ $20.70`
      beside `$20.70` would be noise that looks like a fact.
    */
    const rows = (await run()) ?? [];

    expect(rows.find((row) => row.marketCode === 'US')?.approximateLocal).toBe(
      null,
    );
  });

  it('omits the local figure when no source answered for that currency', async () => {
    /*
      The dangerous case. A missing rate treated as 1 would render `≈ FJ$20.70`
      — a Fijian dollar at parity with the US dollar, which is off by more than
      half and looks exactly like a real answer. The ECB feed does not publish
      FJD at all (checked 2026-08-30), so this is the ordinary path when the
      fallback source is unreachable, not an edge case.
    */
    displayFxRatesMock.mockResolvedValue({ AUD: 1.39 });

    const rows = (await run()) ?? [];
    const fj = rows.find((row) => row.marketCode === 'FJ');

    expect(fj?.price).toEqual({ amountMinor: 2070, currency: 'USD' });
    expect(fj?.approximateLocal).toBeNull();
  });

  it('includes Global, priced in USD with nothing to convert', async () => {
    // Global covers every country with no column of its own — most of the
    // world — and its buyers share no currency.
    const rows = (await run()) ?? [];
    const global = rows.find((row) => row.marketCode === 'GLOBAL');

    expect(global?.label).toBe('Global');
    expect(global?.price).toEqual({ amountMinor: 2070, currency: 'USD' });
    expect(global?.approximateLocal).toBeNull();
  });

  it('asks the resolver for a real country when it asks about Global', async () => {
    /*
      `resolveProductPricing` refuses anything that is not `^[A-Z]{2}$` and
      treats every unnamed country as Global. So the probe is not a stand-in for
      Global — it is a member of the set Global prices, which is the only honest
      way to ask what that set pays.
    */
    await run();

    const codes = resolveProductPricingMock.mock.calls.map(
      (call) => call[1].marketCode,
    );

    expect(codes).toContain('AQ');
    expect(codes).not.toContain('GLOBAL');
  });

  it('carries a refusal through with no price and no conversion', async () => {
    resolveProductPricingMock.mockResolvedValue({
      outcome: 'PRICING_UNAVAILABLE',
      reasonLabel: 'No margin policy — set a category markup',
    });

    const rows = (await run()) ?? [];

    expect(rows.every((row) => row.price === null)).toBe(true);
    expect(rows.every((row) => row.approximateLocal === null)).toBe(true);
    expect(rows[0]?.unavailableLabel).toBe(
      'No margin policy — set a category markup',
    );
  });

  it('fetches rates once for the whole product, not once per destination', async () => {
    // Four destinations resolved; one rate call. A per-destination fetch would
    // be four network round trips to answer one question.
    await run();

    expect(displayFxRatesMock).toHaveBeenCalledTimes(1);
  });
});
