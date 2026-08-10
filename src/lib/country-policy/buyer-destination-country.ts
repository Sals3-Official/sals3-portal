import type { BuyerDestinationCountryPolicy } from './types';

/**
 * Countries where customers may purchase and receive delivery (ADR-003,
 * ADR-014). No allowlist has been owner-approved by any current instruction.
 * Australian seller/business registration does not by itself approve AU, or
 * any other country, as a buyer destination — see
 * `seller-operating-country.ts`, which is independently versioned. Supplier
 * stock-origin countries (CJ's `countryCode`, e.g. `CN`/`US`) and currency,
 * locale, or timezone configuration also cannot populate this allowlist.
 *
 * Fails closed: disabled with an empty allowlist until an explicit owner
 * decision, backed by destination-specific evidence (freight, restrictions,
 * compliance), enables one. Callers must never widen this to a non-empty
 * list on their own — see `runScreening()`'s `checkValidMarket`, which
 * blocks (recoverably) rather than admitting a candidate under a market that
 * was never approved.
 *
 * Temporary Portal-owned configuration provider, not a seller-editable
 * setting and not an Admin Portal UI. ADR-014's future Admin Portal replaces
 * this with a published, versioned policy without changing callers.
 */
const POLICY_VERSION = 'buyer-destination-country-v1-disabled';
const SOURCE = 'no-adr-003-market-approved-yet';

export default function resolveBuyerDestinationCountryPolicy(): BuyerDestinationCountryPolicy {
  return {
    countryCodes: [],
    policyVersion: POLICY_VERSION,
    source: SOURCE,
    effective: 'DISABLED',
  };
}
