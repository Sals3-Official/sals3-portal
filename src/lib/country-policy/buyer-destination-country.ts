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
/**
 * `v3` (owner decision 2026-08-25): the four remaining measured destinations
 * join AU and PH.
 *
 * ## What this re-opens, checked rather than assumed
 *
 * A new version string requeues every decided candidate — 588,850 of them —
 * because it composes into `candidate_evaluations.policy_version`. Before
 * making that change the blast radius was verified rather than feared:
 *
 * - **Nothing is deleted.** There is no `delete()` against
 *   `supplier_candidates`, `candidate_evaluations` or `supplier_snapshots`
 *   anywhere in the codebase. A requeue is an `UPDATE` on the evaluation row;
 *   the candidate and its `feed_snapshot` are untouched.
 * - **No passing candidate can start failing.** `checkValidMarket` is a strict
 *   subset check — every intended destination must be enabled — so widening
 *   the list can only grow the intersection. `NO_VALID_MARKET` is recoverable
 *   by design, and its own doc comment says widening "re-admits every affected
 *   queued candidate".
 * - **No CJ points are spent.** ADR-013 §1a (2026-08-12) made evaluation
 *   local-only; the evaluator is forbidden from calling product detail,
 *   inventory, comments or freight. The ~1.73M-point figure from the
 *   2026-08-11 session predates that change and no longer applies.
 *
 * The real cost is compute: 588,850 rows through the outbox and screening.
 *
 * **What is lost** is each candidate's *previous* decision. `candidate_evaluations`
 * holds one row per candidate with no history, so a `PASS` dated last week
 * becomes a `PASS` dated today. That is a pre-existing gap recorded in `hot.md`,
 * not something this change introduces.
 *
 * A REVERT must restore `buyer-destination-country-v2-au-ph` exactly, not
 * invent a `v4`, or every row is requeued a second time.
 */
const POLICY_VERSION = 'buyer-destination-country-v3-six-measured';
const SOURCE = 'owner-instruction-2026-08-25-open-six-measured-destinations';

export default function resolveBuyerDestinationCountryPolicy(): BuyerDestinationCountryPolicy {
  return {
    countryCodes: ['AU', 'NZ', 'PH', 'US', 'CA', 'FJ'],
    policyVersion: POLICY_VERSION,
    source: SOURCE,
    effective: 'ENABLED',
  };
}
