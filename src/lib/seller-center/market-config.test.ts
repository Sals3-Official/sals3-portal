import { afterEach, describe, expect, it } from 'vitest';
import { getActiveMarket, getAllMarkets } from './market-config';

describe('getActiveMarket', () => {
  const originalMarket = process.env.PORTAL_DEV_MARKET;

  afterEach(() => {
    process.env.PORTAL_DEV_MARKET = originalMarket;
  });

  it('falls back to PH when no market is set', () => {
    delete process.env.PORTAL_DEV_MARKET;

    expect(getActiveMarket().code).toBe('PH');
  });

  it('falls back to PH when the env var is not a real market code', () => {
    process.env.PORTAL_DEV_MARKET = 'US';

    expect(getActiveMarket().code).toBe('PH');
  });

  it('honors a valid market code', () => {
    process.env.PORTAL_DEV_MARKET = 'SG';

    expect(getActiveMarket().code).toBe('SG');
    expect(getActiveMarket().currency).toBe('SGD');
  });
});

describe('getAllMarkets', () => {
  it('returns all 3 illustrative sample markets', () => {
    expect(getAllMarkets().map((market) => market.code)).toEqual([
      'PH',
      'ID',
      'SG',
    ]);
  });
});
