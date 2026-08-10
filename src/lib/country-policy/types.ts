/**
 * Shared vocabulary for the Portal's country/currency policy resolvers
 * (ADR-014). Kept as one small types file so every resolver's shape stays
 * comparable without merging their very different meanings into one type.
 */

export type PolicyEffectiveState = 'ENABLED' | 'DISABLED';

/**
 * Where a seller/business may be registered, verified, and authorized to
 * operate on Sals3. Never proof of buyer destination-country eligibility.
 */
export type SellerOperatingCountryPolicy = {
  countryCodes: string[];
  policyVersion: string;
  source: string;
  effective: PolicyEffectiveState;
};

/**
 * Where customers may purchase and receive delivery. Independent of seller
 * operating-country eligibility, supplier stock origin, and currency/locale/
 * timezone — none of those may populate or imply this allowlist.
 */
export type BuyerDestinationCountryPolicy = {
  countryCodes: string[];
  policyVersion: string;
  source: string;
  effective: PolicyEffectiveState;
};

/** Portal's temporary seller-facing display/settlement currency context. */
export type PortalDisplayCurrencyPolicy = {
  code: string;
  source: string;
};
