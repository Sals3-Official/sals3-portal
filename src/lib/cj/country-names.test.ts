// @vitest-environment node

import { describe, expect, it } from 'vitest';
import cjShippingCountryName from './country-names';

describe('cjShippingCountryName', () => {
  /**
   * The two countries the storefront checkout actually accepts today
   * (`CHECKOUT_ALLOWED_COUNTRIES` in `sals3-ecommerce`), which makes these the
   * only two values `createOrderBody` can put on the wire right now.
   */
  it('maps the two live checkout destinations to CJ names, not codes', () => {
    expect(cjShippingCountryName('AU')).toBe('Australia');
    expect(cjShippingCountryName('PH')).toBe('Philippines');
  });

  it('maps the remaining approved buyer destinations', () => {
    // `resolveBuyerDestinationCountryPolicy()` v3: AU, NZ, PH, US, CA, FJ.
    expect(cjShippingCountryName('NZ')).toBe('New Zealand');
    expect(cjShippingCountryName('US')).toBe('United States of America');
    expect(cjShippingCountryName('CA')).toBe('Canada');
    expect(cjShippingCountryName('FJ')).toBe('Fiji');
  });

  it('keeps a parenthesis that carries naming detail rather than an article', () => {
    // The `(the)` rule strips only the exact group. Stripping every leading
    // "the" would turn Korea into `Korea (Republic of)`, a name CJ does not
    // publish.
    expect(cjShippingCountryName('KR')).toBe('Korea (the Republic of)');
    expect(cjShippingCountryName('BO')).toBe(
      'Bolivia (Plurinational State of)',
    );
  });

  it("uses CJ's spelling where it differs from the everyday English one", () => {
    expect(cjShippingCountryName('VN')).toBe('Viet Nam');
    expect(cjShippingCountryName('CZ')).toBe('Czechia');
    expect(cjShippingCountryName('CN')).toBe('China');
  });

  it('resolves a code whatever its casing or padding', () => {
    // `addressSnapshot` is frozen JSON from the storefront; this module does
    // not get to decide how it was cased when it was written.
    expect(cjShippingCountryName('ph')).toBe('Philippines');
    expect(cjShippingCountryName(' au ')).toBe('Australia');
  });

  it('returns the input unchanged for a code CJ publishes no name for', () => {
    // The pre-existing behaviour, kept deliberately: a paid order must not be
    // stranded by an address the mapping does not recognise.
    expect(cjShippingCountryName('ZZ')).toBe('ZZ');
    expect(cjShippingCountryName('')).toBe('');
    // `CD`'s row on CJ's appendix is malformed, so it is genuinely absent.
    expect(cjShippingCountryName('CD')).toBe('CD');
  });

  it("preserves CJ's own truncation of the United Kingdom", () => {
    // Not a transcription slip: `shippingCountry` is capped at 50 characters
    // and CJ's table publishes the name already cut to exactly that.
    const gb = cjShippingCountryName('GB');

    expect(gb).toBe('United Kingdom of Great Britain and Northern Irela');
    expect(gb).toHaveLength(50);
  });

  it('never emits a name CJ would truncate or a stray non-ASCII space', () => {
    const codes = ['AU', 'PH', 'NZ', 'US', 'CA', 'FJ', 'GB', 'CI', 'EH', 'AX'];

    codes.forEach((code) => {
      const name = cjShippingCountryName(code);

      expect(name.length).toBeLessThanOrEqual(50);
      expect(name).not.toContain('\u00a0');
      expect(name).not.toContain('*');
    });
  });
});
