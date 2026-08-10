import type { SellerOperatingCountryPolicy } from './types';

/**
 * Sals3's own business/seller-registration country (ADR-014). Bogs approved
 * Australia as Sals3's current business/seller operating country on
 * 2026-08-10. This resolves ONLY where a seller/business may be registered
 * and authorized to operate — it never implies, and must never populate,
 * buyer destination-country eligibility. See
 * `buyer-destination-country.ts`, which is independently versioned and
 * currently disabled.
 *
 * Temporary Portal-owned configuration provider, not a seller-editable
 * setting and not an Admin Portal UI. ADR-014's future Admin Portal replaces
 * this with a published, versioned policy without changing callers.
 */
const POLICY_VERSION = 'seller-operating-country-v1';
const SOURCE = 'owner-decision-2026-08-10-au-business-registration';

export default function resolveSellerOperatingCountryPolicy(): SellerOperatingCountryPolicy {
  return {
    countryCodes: ['AU'],
    policyVersion: POLICY_VERSION,
    source: SOURCE,
    effective: 'ENABLED',
  };
}
