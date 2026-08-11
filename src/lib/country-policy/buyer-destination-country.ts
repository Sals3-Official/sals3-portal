import type { BuyerDestinationCountryPolicy } from './types';

/**
 * Countries where customers may purchase and receive delivery (ADR-003,
 * ADR-014). Australia and the Philippines are enabled by owner instruction
 * on 2026-08-11.
 *
 * Australian seller/business registration does not by itself approve AU, or
 * any other country, as a buyer destination — see
 * `seller-operating-country.ts`, which is independently versioned. AU
 * appears here because it was approved as a destination in its own right,
 * NOT because it is the seller's operating country, and the two lists must
 * never be derived from one another. Supplier stock-origin countries (CJ's
 * `countryCode`, e.g. `CN`/`US`) and currency, locale, or timezone
 * configuration also cannot populate this allowlist.
 *
 * Still fails closed by construction: an empty list or a `DISABLED` state
 * blocks every candidate, and `runScreening()`'s `checkValidMarket` blocks
 * (recoverably) rather than admitting a candidate under a market that was
 * never approved. Widening this list is an owner decision that must be
 * backed by destination-specific evidence — freight, restrictions,
 * compliance — recorded in `SOURCE` below.
 *
 * Changing `POLICY_VERSION` is not cosmetic: it composes into every stored
 * `candidate_evaluations.policy_version` via
 * `composeEvaluationPolicyVersion`, and the freshness sweep requeues every
 * decided row whose stored version no longer matches. A new version string
 * therefore re-opens historical decisions on purpose — and a REVERT must
 * restore the exact previous string, not invent a new one, or every row is
 * requeued a second time.
 *
 * Temporary Portal-owned configuration provider, not a seller-editable
 * setting and not an Admin Portal UI. ADR-014's future Admin Portal replaces
 * this with a published, versioned policy without changing callers.
 */
const POLICY_VERSION = 'buyer-destination-country-v2-au-ph';
const SOURCE = 'owner-instruction-2026-08-11-au-ph';

export default function resolveBuyerDestinationCountryPolicy(): BuyerDestinationCountryPolicy {
  return {
    countryCodes: ['AU', 'PH'],
    policyVersion: POLICY_VERSION,
    source: SOURCE,
    effective: 'ENABLED',
  };
}
