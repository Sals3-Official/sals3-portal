import { describe, expect, it } from 'vitest';
import resolveSellerOperatingCountryPolicy from './seller-operating-country';

describe('resolveSellerOperatingCountryPolicy', () => {
  it('returns enabled AU with a policy version and source', () => {
    const policy = resolveSellerOperatingCountryPolicy();

    expect(policy.countryCodes).toEqual(['AU']);
    expect(policy.effective).toBe('ENABLED');
    expect(policy.policyVersion).toBeTruthy();
    expect(policy.source).toBeTruthy();
  });

  it('is deterministic and takes no input', () => {
    expect(resolveSellerOperatingCountryPolicy()).toEqual(
      resolveSellerOperatingCountryPolicy(),
    );
  });
});
