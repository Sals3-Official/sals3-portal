import { describe, expect, it } from 'vitest';
import resolvePortalDisplayCurrency from './currency';
import resolveBuyerDestinationCountryPolicy from './buyer-destination-country';

describe('resolvePortalDisplayCurrency', () => {
  it('returns AUD as the temporary Portal display currency', () => {
    const currency = resolvePortalDisplayCurrency();

    expect(currency.code).toBe('AUD');
    expect(currency.source).toBeTruthy();
  });

  it('does not enable any buyer destination just by declaring a display currency', () => {
    const currency = resolvePortalDisplayCurrency();
    const buyerDestination = resolveBuyerDestinationCountryPolicy();

    expect(currency.code).toBe('AUD');
    expect(buyerDestination.effective).toBe('DISABLED');
    expect(buyerDestination.countryCodes).toEqual([]);
  });
});
