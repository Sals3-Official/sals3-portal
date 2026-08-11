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

    // The buyer allowlist is now non-empty, so "it is empty" can no longer
    // carry this test. PH does the work instead: it is enabled as a
    // destination while the display currency is AUD, which is only possible
    // if the two are resolved independently. A currency-derived allowlist
    // could not produce PH from AUD.
    expect(currency.code).toBe('AUD');
    expect(buyerDestination.countryCodes).toContain('PH');
    expect(buyerDestination.source).not.toContain(currency.code);
  });
});
