import { describe, expect, it } from 'vitest';
import resolveBuyerDestinationCountryPolicy from './buyer-destination-country';
import resolveSellerOperatingCountryPolicy from './seller-operating-country';

describe('resolveBuyerDestinationCountryPolicy', () => {
  it('enables exactly the owner-approved destinations, and carries an identifiable version and source', () => {
    const policy = resolveBuyerDestinationCountryPolicy();

    expect(policy.countryCodes).toEqual(['AU', 'PH']);
    expect(policy.effective).toBe('ENABLED');
    expect(policy.policyVersion).toBeTruthy();
    expect(policy.source).toBeTruthy();
  });

  it('is not derived from the seller operating-country allowlist - AU registration does not imply AU delivery', () => {
    const buyer = resolveBuyerDestinationCountryPolicy();
    const seller = resolveSellerOperatingCountryPolicy();

    // Both legitimately contain AU now, so "not.toContain('AU')" can no
    // longer carry this test. What must still hold is INDEPENDENCE: the two
    // lists are separately versioned, separately sourced, and one is not a
    // copy of the other. A future change that widened the buyer list by
    // copying the seller list would break every assertion below.
    expect(buyer.countryCodes).not.toEqual(seller.countryCodes);
    expect(buyer.policyVersion).not.toBe(seller.policyVersion);
    expect(buyer.source).not.toBe(seller.source);
    expect(buyer.countryCodes).toContain('PH');
    expect(seller.countryCodes).not.toContain('PH');
  });
});
