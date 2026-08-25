import { describe, expect, it } from 'vitest';
import resolveBuyerDestinationCountryPolicy from '@/lib/country-policy/buyer-destination-country';
import {
  isPricingScopeDestination,
  listPricingScopeDestinations,
} from './pricing-scope-destinations';

/**
 * Owner decision 2026-08-25: all six measured destinations are open, and a
 * margin may be set for each of them.
 *
 * These cases pin the two facts a later reader will need — what the list is,
 * and that it is derived rather than a second copy — because the obvious
 * tidy-up is to inline the six somewhere, and an inlined copy is what drifts.
 */

describe('the pricing scope', () => {
  it('offers every destination Sals3 has measured freight for', () => {
    expect(
      listPricingScopeDestinations()
        .map((destination) => destination.code)
        .sort(),
    ).toEqual(['AU', 'CA', 'FJ', 'NZ', 'PH', 'US']);
  });

  it('is derived from the buyer-destination policy, not listed separately', () => {
    const permitted = resolveBuyerDestinationCountryPolicy().countryCodes;

    /**
     * The relationship, asserted rather than assumed. If the global policy ever
     * narrows, the pricing scope must narrow with it — otherwise the screen
     * keeps offering a destination nothing can be published into, and a seller
     * configures a rule that can never fire.
     */
    listPricingScopeDestinations().forEach((destination) => {
      expect(permitted).toContain(destination.code);
    });
    expect(listPricingScopeDestinations()).toHaveLength(permitted.length);
  });

  it('gives every code the shape both policy tables enforce', () => {
    // `pricing_category_policies_market_code_shape` and its store-default twin
    // are `^[A-Z]{2}$`. A label-shaped entry would be refused by Postgres at the
    // moment a seller saved, not here.
    listPricingScopeDestinations().forEach((destination) => {
      expect(destination.code).toMatch(/^[A-Z]{2}$/);
      expect(destination.label.length).toBeGreaterThan(1);
    });
  });

  it('refuses anything not on the list', () => {
    expect(isPricingScopeDestination('GB')).toBe(false);
    expect(isPricingScopeDestination('au')).toBe(false);
    expect(isPricingScopeDestination('')).toBe(false);
  });
});
