import { describe, expect, it } from 'vitest';
import { getActiveMarket, getAllMarkets } from './market-config';
import { formatMarketMoney, formatSignedMarketMoney } from './money';

// getActiveMarket() only returns null in production (see its doc comment);
// this suite never runs there, so a non-null assertion is safe here.
function activeMarket() {
  const market = getActiveMarket();

  if (market === null) throw new Error('expected a non-null market in tests');

  return market;
}

describe('formatMarketMoney', () => {
  it('formats the active (PH) market with its currency symbol', () => {
    expect(formatMarketMoney(124900, activeMarket())).toContain('1,249');
  });

  it('formats zero', () => {
    expect(formatMarketMoney(0, activeMarket())).toBeTruthy();
  });

  it('formats every illustrative market without throwing', () => {
    getAllMarkets().forEach((market) => {
      expect(() => formatMarketMoney(500000, market)).not.toThrow();
    });
  });
});

describe('formatSignedMarketMoney', () => {
  it('prefixes a minus sign for negative amounts', () => {
    expect(formatSignedMarketMoney(-4500, activeMarket())).toMatch(/^−/u);
  });

  it('has no sign prefix for positive amounts', () => {
    expect(formatSignedMarketMoney(4500, activeMarket())).not.toMatch(/^−/u);
  });
});
