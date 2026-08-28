import { describe, expect, it } from 'vitest';
import {
  freeShippingProgress,
  freeShippingThresholdAmountMinor,
} from './free-shipping';

const ENVIRONMENT = {
  SALS3_FREE_STANDARD_SHIPPING_PH_USD: '12',
  SALS3_FREE_STANDARD_SHIPPING_AU_USD: '25',
  SALS3_FREE_STANDARD_SHIPPING_FJ_USD: '55',
};

describe('freeShippingProgress', () => {
  it('reads the owner-approved USD thresholds from environment', () => {
    expect(freeShippingThresholdAmountMinor('PH', ENVIRONMENT)).toBe(1200);
    expect(freeShippingThresholdAmountMinor('AU', ENVIRONMENT)).toBe(2500);
    expect(freeShippingThresholdAmountMinor('FJ', ENVIRONMENT)).toBe(5500);
  });

  it('reports the exact amount remaining below the threshold', () => {
    expect(freeShippingProgress('AU', 1900, ENVIRONMENT)).toEqual({
      thresholdAmountMinor: 2500,
      subtotalAmountMinor: 1900,
      amountRemainingMinor: 600,
      eligible: false,
      currency: 'USD',
    });
  });

  it.each([
    ['PH', 1200],
    ['AU', 2500],
    ['FJ', 5500],
  ] as const)('unlocks %s at its exact threshold', (country, subtotal) => {
    expect(freeShippingProgress(country, subtotal, ENVIRONMENT)).toMatchObject({
      amountRemainingMinor: 0,
      eligible: true,
    });
  });

  it('fails closed when a threshold is missing or invalid', () => {
    expect(() => freeShippingThresholdAmountMinor('PH', {})).toThrow(
      /SALS3_FREE_STANDARD_SHIPPING_PH_USD/,
    );
    expect(() =>
      freeShippingThresholdAmountMinor('PH', {
        SALS3_FREE_STANDARD_SHIPPING_PH_USD: 'free',
      }),
    ).toThrow(/positive USD amount/);
  });
});
