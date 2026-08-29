import { describe, expect, it } from 'vitest';
import { listPricingScopeDestinations } from '@/modules/pricing/pricing-scope-destinations';
import {
  CHECKOUT_DESTINATION_CODES,
  listCheckoutDestinations,
} from './checkout-destinations';

/**
 * Three lists answer three questions and currently give two different answers:
 * six destinations may be screened for and priced, three may be checked out to.
 * These tests pin the gap open on purpose — a future change that collapses them
 * should have to delete an assertion that says why they differ.
 */
describe('listCheckoutDestinations', () => {
  it('offers only the destinations freight can actually quote', () => {
    expect(listCheckoutDestinations().map((item) => item.code)).toEqual([
      'AU',
      'PH',
      'FJ',
    ]);
  });

  /**
   * The pricing list is wider by design (owner decision 2026-08-25 opened six
   * measured destinations). A buyer in one of the other three can be priced and
   * then gets no freight quote, so no order can be created — which is exactly
   * why a storefront preview must not offer them.
   */
  it('is a strict subset of the destinations a margin may be set for', () => {
    const priceable = listPricingScopeDestinations().map((item) => item.code);
    const checkout = listCheckoutDestinations().map((item) => item.code);

    expect(checkout.every((code) => priceable.includes(code))).toBe(true);
    expect(priceable.length).toBeGreaterThan(checkout.length);
  });

  /**
   * Labels are borrowed rather than written again, so "Philippines" is spelled
   * in one place. A code with no label would render as a bare `FJ`.
   */
  it('carries a real name for every destination, never a bare code', () => {
    listCheckoutDestinations().forEach((destination) => {
      expect(destination.label).not.toBe('');
      expect(destination.label).not.toBe(destination.code);
    });
  });

  it('exposes the codes as the one list other modules read', () => {
    expect([...CHECKOUT_DESTINATION_CODES]).toEqual(
      listCheckoutDestinations().map((item) => item.code),
    );
  });
});
