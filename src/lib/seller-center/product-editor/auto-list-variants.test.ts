import { describe, expect, it } from 'vitest';
import type { VariantFixture } from './types';
import { autoListVariants } from './derive';

const variant = (over: Partial<VariantFixture>): VariantFixture => ({
  id: 'v1',
  optionLabel: 'Storage box',
  sellerSku: '',
  supplierCost: { amountMinor: 272, currency: 'USD' },
  retailPrice: { amountMinor: 0, currency: 'USD' },
  supplierStock: 20_000,
  warehouseLabel: 'CN',
  hasImage: false,
  enabled: false,
  listingState: 'NOT_LISTED',
  attention: null,
  supplierVariantId: 'sv1',
  packedWeightGrams: 100,
  evidenceCapturedAt: '2026-08-19T20:00:00.000Z',
  ...over,
});

describe('autoListVariants', () => {
  it('switches on an in-stock variant nobody has ruled out', () => {
    // Replaces `Enable eligible in-stock variants`: the data already settled
    // this, so a seller pressing a button for it was work with no decision in it.
    expect(autoListVariants([variant({ enabled: false })])[0]?.enabled).toBe(
      true,
    );
  });

  it('switches off a variant with no stock', () => {
    expect(
      autoListVariants([variant({ enabled: true, supplierStock: 0 })])[0]
        ?.enabled,
    ).toBe(false);
  });

  it('never switches on a blocked variant', () => {
    // The invariant the removed buttons carried in their own copy. A policy or
    // the supplier ruled these out, and opening the editor is not new
    // information about either.
    expect(
      autoListVariants([
        variant({ enabled: false, listingState: 'BLOCKED' }),
      ])[0]?.enabled,
    ).toBe(false);
  });

  it('never switches on a paused variant', () => {
    expect(
      autoListVariants([variant({ enabled: false, listingState: 'PAUSED' })])[0]
        ?.enabled,
    ).toBe(false);
  });

  it('still switches off a blocked variant that has no stock', () => {
    // Being ruled out protects a variant from being switched *on*, never from
    // being switched off when the stock is gone.
    expect(
      autoListVariants([
        variant({ enabled: true, listingState: 'BLOCKED', supplierStock: 0 }),
      ])[0]?.enabled,
    ).toBe(false);
  });
});
