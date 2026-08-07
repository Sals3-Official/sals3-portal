import { describe, expect, it } from 'vitest';
import {
  PRODUCT_EDITOR_FIXTURE_KEYS,
  resolveProductEditorFixture,
} from './product-editor';

const EXPECTED_KEYS = [
  'pass',
  'attention',
  'blocked',
  'mixed-stock',
  'market-route',
  'price-spike',
  'delisted',
  'stale-evidence',
];

/** Anything that must never be modelled, let alone rendered. */
const CREDENTIAL_PATTERN =
  /(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|bearer|authorization)/i;

describe('product editor fixture allow list', () => {
  it('exposes exactly the documented development fixtures', () => {
    expect(PRODUCT_EDITOR_FIXTURE_KEYS.sort()).toEqual(
      [...EXPECTED_KEYS].sort(),
    );
  });

  it('resolves every allow-listed key', () => {
    EXPECTED_KEYS.forEach((key) => {
      expect(resolveProductEditorFixture(key)?.fixtureKey).toBe(key);
    });
  });

  it('returns null for an unknown key instead of a default product', () => {
    expect(resolveProductEditorFixture('nope')).toBeNull();
    expect(resolveProductEditorFixture('')).toBeNull();
    expect(resolveProductEditorFixture(undefined)).toBeNull();
  });

  it('returns null for a real-looking candidate id', () => {
    expect(
      resolveProductEditorFixture('8f2c1a7e-6f0b-4a1d-9d3e-77e2c0b41a55'),
    ).toBeNull();
  });

  it('does not resolve inherited Object properties as fixtures', () => {
    expect(resolveProductEditorFixture('toString')).toBeNull();
    expect(resolveProductEditorFixture('constructor')).toBeNull();
  });
});

describe('fixture safety', () => {
  it('never carries anything credential-shaped', () => {
    EXPECTED_KEYS.forEach((key) => {
      const serialized = JSON.stringify(resolveProductEditorFixture(key));

      expect(serialized).not.toMatch(CREDENTIAL_PATTERN);
    });
  });

  it('models only markets the seller has enabled, and counts the rest', () => {
    EXPECTED_KEYS.forEach((key) => {
      const found = resolveProductEditorFixture(key);

      expect(found?.marketsNotEnabledCount).toBeGreaterThan(0);
      found?.markets.forEach((market) => {
        expect(market.isSampleMarket).toBe(true);
      });
    });
  });

  it('states its money in minor units with an explicit currency', () => {
    EXPECTED_KEYS.forEach((key) => {
      resolveProductEditorFixture(key)?.variants.forEach((variant) => {
        expect(Number.isInteger(variant.supplierCost.amountMinor)).toBe(true);
        expect(variant.supplierCost.currency).toBe(
          resolveProductEditorFixture(key)?.source.sourceCurrency,
        );
      });
    });
  });
});
