import resolveBuyerDestinationCountryPolicy from '@/lib/country-policy/buyer-destination-country';

/**
 * What a seller may actually be set up to sell to today — the server-owned
 * allow list behind Market Rules setup.
 *
 * This is deliberately NOT the global catalogue buyer-destination policy and
 * must never be substituted for it. That policy
 * (`lib/country-policy/buyer-destination-country.ts`) decides which
 * destinations a *candidate* may be evaluated against, composes into every
 * stored `candidate_evaluations.policy_version`, and is consumed by the
 * screening resolver. This module decides which destinations a *seller* may
 * be offered during profile setup, and nothing here feeds screening. Keeping
 * them apart is what lets ADR-014's future Admin Portal replace either source
 * without changing candidate-evaluation semantics.
 *
 * The relationship between them is one-directional and fail-closed: a
 * destination is offerable only if this module lists it AND the global policy
 * currently permits it. So narrowing the global policy narrows setup
 * automatically, while widening it can never silently widen what sellers may
 * configure — that stays an explicit edit here, with a new
 * `CAPABILITY_VERSION`.
 *
 * Nothing in this module asserts a commercial contract. AU and PH are a
 * bounded evidence pilot: no payment onboarding, freight quote, tax
 * treatment, or payout rail has been proven for either, so every option
 * carries the list of capabilities still outstanding rather than an implied
 * "launch market". `authorizedSellingCurrencyCodes` is empty on purpose —
 * see its own comment.
 */

const CAPABILITY_VERSION = 'seller-market-capability-v1-au-ph-bounded-pilot';
const SOURCE = 'owner-instruction-2026-08-11-au-ph-bounded-pilot';

/**
 * Operational capabilities a destination needs before it is a real launch
 * market. None of these is proven for any pilot destination yet, and this
 * codebase must not imply otherwise — see ADR-015 §5 and ADR-003.
 */
export const MARKET_CAPABILITY_REQUIREMENTS = [
  'PAYMENTS',
  'LOGISTICS',
  'TAX',
  'PAYOUT',
] as const;

export type MarketCapabilityRequirement =
  (typeof MARKET_CAPABILITY_REQUIREMENTS)[number];

export type MarketReadiness = 'BOUNDED_PILOT';

export type MarketDestinationCapability = {
  destinationCountryCode: string;
  destinationName: string;
  readiness: MarketReadiness;
  /**
   * Empty until a per-destination selling currency is actually authorized.
   * The Portal's reference/display currency (AUD) is a display dimension
   * that follows Sals3's own business registration — it is not a checkout,
   * settlement, or conversion contract for a buyer destination, so it must
   * not be copied in here as if a seller had been approved to sell in it.
   */
  authorizedSellingCurrencyCodes: readonly string[];
  /** Still outstanding for this destination; never rendered as satisfied. */
  pendingCapabilities: readonly MarketCapabilityRequirement[];
};

export type SellerMarketCapabilities = {
  capabilityVersion: string;
  source: string;
  destinations: readonly MarketDestinationCapability[];
};

/**
 * The destinations this module is willing to offer, before intersecting with
 * the global policy. Adding an entry here is an owner decision that needs
 * destination-specific evidence, exactly like widening the global allowlist.
 */
const PILOT_DESTINATIONS: readonly MarketDestinationCapability[] = [
  {
    destinationCountryCode: 'AU',
    destinationName: 'Australia',
    readiness: 'BOUNDED_PILOT',
    authorizedSellingCurrencyCodes: [],
    pendingCapabilities: MARKET_CAPABILITY_REQUIREMENTS,
  },
  {
    destinationCountryCode: 'PH',
    destinationName: 'Philippines',
    readiness: 'BOUNDED_PILOT',
    authorizedSellingCurrencyCodes: [],
    pendingCapabilities: MARKET_CAPABILITY_REQUIREMENTS,
  },
];

export function resolveSellerMarketCapabilities(): SellerMarketCapabilities {
  const globalPolicy = resolveBuyerDestinationCountryPolicy();

  // A disabled global policy offers nothing, rather than falling back to the
  // pilot list — the same fail-closed posture the screening resolver takes.
  const permitted =
    globalPolicy.effective === 'ENABLED' ? globalPolicy.countryCodes : [];

  return {
    capabilityVersion: CAPABILITY_VERSION,
    source: SOURCE,
    destinations: PILOT_DESTINATIONS.filter((destination) =>
      permitted.includes(destination.destinationCountryCode),
    ),
  };
}

/**
 * The single gate every write path uses. A destination the browser posted is
 * only ever a candidate string until this returns it; `SG`, `ID`, lowercase
 * variants, and anything else resolve to `null`.
 */
export function findAuthorizedDestination(
  destinationCountryCode: string,
): MarketDestinationCapability | null {
  return (
    resolveSellerMarketCapabilities().destinations.find(
      (destination) =>
        destination.destinationCountryCode === destinationCountryCode,
    ) ?? null
  );
}

/**
 * A currency is acceptable only when the destination itself authorizes it.
 * With `authorizedSellingCurrencyCodes` empty, the only valid answer today is
 * "none declared" — which the caller represents as `null`, never as a guess.
 */
export function isAuthorizedSellingCurrency(
  destination: MarketDestinationCapability,
  currencyCode: string,
): boolean {
  return destination.authorizedSellingCurrencyCodes.includes(currencyCode);
}
