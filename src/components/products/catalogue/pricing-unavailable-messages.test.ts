import { describe, expect, it } from 'vitest';
import describePricingUnavailable from './pricing-unavailable-messages';

describe('describePricingUnavailable', () => {
  /**
   * The cell this feeds used to read "Not available" and stop, while the offer
   * row already carried the resolver's verdict. The whole point is that the
   * reason a price is missing is the same reason the publish will be refused.
   */
  it('turns a resolver verdict into words a seller can act on', () => {
    expect(describePricingUnavailable('SUPPLIER_COST_UNAVAILABLE')).toBe(
      'No supplier cost observed',
    );
    expect(describePricingUnavailable('CATEGORY_POLICY_REQUIRED')).toBe(
      'No margin for this category',
    );
  });

  /** Written before the resolver has run at all. Nothing is wrong yet. */
  it('separates "not priced yet" from a refusal', () => {
    expect(describePricingUnavailable('PRICING_NOT_ATTEMPTED')).toBe(
      'Not priced yet',
    );
  });

  /** A priced offer carries no reason, and the cell shows only the price. */
  it('says nothing when there is no reason', () => {
    expect(describePricingUnavailable(null)).toBeNull();
  });

  /**
   * A database token in a table cell teaches a seller nothing they could not
   * guess from the empty price, so an unknown code renders no line at all
   * rather than leaking the code itself.
   */
  it('never prints a raw code it does not recognise', () => {
    expect(describePricingUnavailable('SOME_FUTURE_REASON')).toBeNull();
  });
});
