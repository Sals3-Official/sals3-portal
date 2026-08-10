import { describe, expect, it } from 'vitest';
import { deriveStockEvidence, type StockObservation } from './stock-evidence';

function observation(overrides: Partial<StockObservation>): StockObservation {
  return {
    countryCode: 'CN',
    cjInventory: null,
    factoryInventory: null,
    totalInventory: null,
    ...overrides,
  };
}

describe('deriveStockEvidence', () => {
  it('reports UNKNOWN_STOCK for no observations at all', () => {
    expect(deriveStockEvidence([])).toBe('UNKNOWN_STOCK');
  });

  it('reports UNKNOWN_STOCK when every observation has no known total', () => {
    expect(
      deriveStockEvidence([
        observation({ countryCode: 'CN' }),
        observation({ countryCode: 'US' }),
      ]),
    ).toBe('UNKNOWN_STOCK');
  });

  it('reports ZERO_STOCK when every known total is zero', () => {
    expect(
      deriveStockEvidence([
        observation({ totalInventory: 0, cjInventory: 0, factoryInventory: 0 }),
        observation({ countryCode: 'US' }), // unknown alongside a known zero
      ]),
    ).toBe('ZERO_STOCK');
  });

  it('reports CJ_WAREHOUSE_STOCK when only cjInventory is positive', () => {
    expect(
      deriveStockEvidence([
        observation({
          totalInventory: 10,
          cjInventory: 10,
          factoryInventory: 0,
        }),
      ]),
    ).toBe('CJ_WAREHOUSE_STOCK');
  });

  it('reports FACTORY_BACKED_STOCK when only factoryInventory is positive', () => {
    expect(
      deriveStockEvidence([
        observation({
          totalInventory: 6406,
          cjInventory: 0,
          factoryInventory: 6406,
        }),
      ]),
    ).toBe('FACTORY_BACKED_STOCK');
  });

  it('reports MIXED_STOCK when one origin is CJ-backed and another is factory-backed', () => {
    expect(
      deriveStockEvidence([
        observation({
          countryCode: 'CN',
          totalInventory: 5,
          cjInventory: 5,
          factoryInventory: 0,
        }),
        observation({
          countryCode: 'US',
          totalInventory: 3,
          cjInventory: 0,
          factoryInventory: 3,
        }),
      ]),
    ).toBe('MIXED_STOCK');
  });

  it('reports MIXED_STOCK when a single origin has both CJ and factory stock', () => {
    expect(
      deriveStockEvidence([
        observation({ totalInventory: 8, cjInventory: 5, factoryInventory: 3 }),
      ]),
    ).toBe('MIXED_STOCK');
  });

  it('reports UNKNOWN_STOCK when a positive total cannot be attributed to either pool', () => {
    // A CJ data anomaly: total says stock exists but neither component
    // accounts for it. Must never be guessed as CJ or factory stock.
    expect(
      deriveStockEvidence([
        observation({ totalInventory: 4, cjInventory: 0, factoryInventory: 0 }),
      ]),
    ).toBe('UNKNOWN_STOCK');
  });

  it('ignores a negative total the same as zero', () => {
    expect(
      deriveStockEvidence([
        observation({
          totalInventory: -1,
          cjInventory: -1,
          factoryInventory: 0,
        }),
      ]),
    ).toBe('ZERO_STOCK');
  });
});
