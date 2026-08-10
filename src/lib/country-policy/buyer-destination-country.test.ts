import { describe, expect, it } from 'vitest';
import resolveBuyerDestinationCountryPolicy from './buyer-destination-country';
import resolveSellerOperatingCountryPolicy from './seller-operating-country';

describe('resolveBuyerDestinationCountryPolicy', () => {
  it('fails closed: disabled with an empty allowlist until explicitly approved', () => {
    const policy = resolveBuyerDestinationCountryPolicy();

    expect(policy.countryCodes).toEqual([]);
    expect(policy.effective).toBe('DISABLED');
    expect(policy.policyVersion).toBeTruthy();
    expect(policy.source).toBeTruthy();
  });

  it('never mirrors the seller operating-country allowlist - AU registration does not imply AU delivery', () => {
    const buyer = resolveBuyerDestinationCountryPolicy();
    const seller = resolveSellerOperatingCountryPolicy();

    expect(buyer.countryCodes).not.toContain('AU');
    expect(buyer.countryCodes).not.toEqual(seller.countryCodes);
    expect(buyer.policyVersion).not.toBe(seller.policyVersion);
    expect(buyer.source).not.toBe(seller.source);
  });
});
