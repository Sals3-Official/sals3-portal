import { describe, expect, it } from 'vitest';
import {
  freeShippingCeilingAmountMinor,
  freeShippingContributionMinor,
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

describe('freeShippingCeilingAmountMinor', () => {
  it('fails open to the qualifying threshold when no ceiling is configured', () => {
    // No SALS3_FREE_STANDARD_SHIPPING_CEILING_* var exists in production
    // today. Unlike a missing threshold, this must never throw.
    expect(freeShippingCeilingAmountMinor('FJ', ENVIRONMENT)).toBe(5500);
    expect(freeShippingCeilingAmountMinor('AU', ENVIRONMENT)).toBe(2500);
    expect(freeShippingCeilingAmountMinor('PH', ENVIRONMENT)).toBe(1200);
  });

  it('reads an explicit ceiling when one is configured', () => {
    expect(
      freeShippingCeilingAmountMinor('FJ', {
        ...ENVIRONMENT,
        SALS3_FREE_STANDARD_SHIPPING_CEILING_FJ_USD: '8',
      }),
    ).toBe(800);
  });

  it('rejects an invalid explicit ceiling the same way a threshold is rejected', () => {
    expect(() =>
      freeShippingCeilingAmountMinor('FJ', {
        ...ENVIRONMENT,
        SALS3_FREE_STANDARD_SHIPPING_CEILING_FJ_USD: 'unlimited',
      }),
    ).toThrow(/positive USD amount/);
  });
});

describe('freeShippingContributionMinor', () => {
  it('covers the real quote in full when it is under the ceiling', () => {
    // AU's real Standard quote at a normal basket ($8.10) is far under its
    // $25 threshold-as-ceiling default: the common case is unaffected.
    expect(freeShippingContributionMinor('AU', 810, ENVIRONMENT)).toBe(810);
  });

  it('caps the contribution when the real quote exceeds the ceiling', () => {
    // A heavy Fiji basket: real freight can reach $98.32 (2kg), against a
    // $55 threshold-as-ceiling default. Sals3 contributes at most $55; the
    // buyer would owe the $43.32 remainder.
    expect(freeShippingContributionMinor('FJ', 9832, ENVIRONMENT)).toBe(5500);
  });

  it('never contributes more than an explicit configured ceiling', () => {
    expect(
      freeShippingContributionMinor('FJ', 9832, {
        ...ENVIRONMENT,
        SALS3_FREE_STANDARD_SHIPPING_CEILING_FJ_USD: '8',
      }),
    ).toBe(800);
  });
});
