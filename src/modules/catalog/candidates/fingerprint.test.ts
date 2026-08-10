import { describe, expect, it } from 'vitest';
import type { CjProduct } from '@/lib/cj/normalize';
import { computeFingerprint } from './fingerprint';

function product(overrides: Partial<CjProduct> = {}): CjProduct {
  return {
    id: 'pid-1',
    name: 'Plain phone case',
    sku: 'SKU-1',
    imageUrl: null,
    category: 'Phone accessories',
    priceCentsUsd: 500,
    weight: '100 g',
    productType: 'accessory',
    supplier: 'CJ',
    freeShipping: false,
    shipsFrom: ['CN'],
    listedCount: 10,
    createdAt: null,
    ...overrides,
  };
}

describe('computeFingerprint - material vs ranking signals (ADR-010 §12.5)', () => {
  it('changes when a material field changes: name, category, price, or shipping origin', () => {
    const base = computeFingerprint(product());

    expect(computeFingerprint(product({ name: 'Renamed case' }))).not.toBe(
      base,
    );
    expect(computeFingerprint(product({ category: 'Gadgets' }))).not.toBe(base);
    expect(computeFingerprint(product({ priceCentsUsd: 600 }))).not.toBe(base);
    expect(computeFingerprint(product({ shipsFrom: ['CN', 'US'] }))).not.toBe(
      base,
    );
  });

  it('does NOT change on a popularity-only listedCount change - ranking data never spends qualification calls', () => {
    const base = computeFingerprint(product({ listedCount: 10 }));

    expect(computeFingerprint(product({ listedCount: 9_999 }))).toBe(base);
  });

  it('is order-insensitive over shipping origins', () => {
    expect(computeFingerprint(product({ shipsFrom: ['US', 'CN'] }))).toBe(
      computeFingerprint(product({ shipsFrom: ['CN', 'US'] })),
    );
  });
});
