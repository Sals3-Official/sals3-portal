import { describe, expect, it } from 'vitest';
import { getActiveMarket, getAllMarkets } from './market-config';
import { formatMarketMoney, formatSignedMarketMoney } from './money';

describe('formatMarketMoney', () => {
  it('formats the active (PH) market with its currency symbol', () => {
    expect(formatMarketMoney(124900, getActiveMarket())).toContain('1,249');
  });

  it('formats zero', () => {
    expect(formatMarketMoney(0, getActiveMarket())).toBeTruthy();
  });

  it('formats every illustrative market without throwing', () => {
    getAllMarkets().forEach((market) => {
      expect(() => formatMarketMoney(500000, market)).not.toThrow();
    });
  });
});

describe('formatSignedMarketMoney', () => {
  it('prefixes a minus sign for negative amounts', () => {
    expect(formatSignedMarketMoney(-4500, getActiveMarket())).toMatch(/^−/u);
  });

  it('has no sign prefix for positive amounts', () => {
    expect(formatSignedMarketMoney(4500, getActiveMarket())).not.toMatch(/^−/u);
  });
});
