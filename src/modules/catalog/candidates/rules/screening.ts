import type { BuyerDestinationCountryPolicy } from '@/lib/country-policy/types';
import type { FeedSnapshot, RuleFinding } from './contracts';
import {
  COUNTERFEIT_SIGNAL_KEYWORDS,
  MAX_PRICE_USD_CENTS,
  MIN_PRICE_USD_CENTS,
  PROHIBITED_CATEGORY_KEYWORDS,
  PROTECTED_BRAND_DENYLIST,
} from './policy';

/**
 * Cheap screening rules (spec's "cheap automatic screening" step) - run
 * against the CJ `/product/list` feed data captured at ingestion, before any
 * CJ evidence-fetch call is made. A `BLOCK` finding here saves the ~30 CJ
 * points that a full evidence fetch would otherwise cost.
 *
 * `COUNTRY_RESTRICTED` (per-category market rules) stays a reserved, unused
 * reason code until a second enabled market exists with different category
 * rules than the first.
 */

/**
 * The buyer-destination policy and the candidate's own persisted
 * `intended_market_codes`, resolved exactly once at the evaluation boundary
 * (`evaluate.ts`) and passed down as explicit inputs - never re-resolved
 * inside this rule, so one evaluation can never observe two different
 * policy versions.
 */
export type MarketValidationInput = {
  buyerDestinationPolicy: BuyerDestinationCountryPolicy;
  candidateDestinationCodes: string[];
};

/**
 * Fails closed in three distinct, truthfully-detailed ways (Codex review
 * fix): no enabled destination policy exists yet (ADR-014's approved-but-
 * disabled default); this specific candidate has no intended destination
 * recorded at all; or its intended destination(s) are not (all) inside the
 * currently enabled allowlist. AU seller/business registration is never one
 * of the candidate's own destinations unless a separate, explicit ingestion
 * decision put it there - this rule only ever reads what is already stored.
 *
 * The rule is a strict subset check: every one of the candidate's intended
 * destinations must already be enabled. A candidate is never silently
 * narrowed to only its allowed destinations, and never widened to a newly
 * enabled country it never asked for - it either fully qualifies or it
 * blocks, recoverably (`TEMPORARILY_INELIGIBLE`; `NO_VALID_MARKET` is not a
 * permanent reason code), so approving/widening a real policy re-admits
 * every affected queued candidate without touching this file again.
 */
export function checkValidMarket(
  input: MarketValidationInput,
): RuleFinding | null {
  const { buyerDestinationPolicy, candidateDestinationCodes } = input;

  if (
    buyerDestinationPolicy.effective === 'DISABLED' ||
    buyerDestinationPolicy.countryCodes.length === 0
  ) {
    return {
      reasonCode: 'NO_VALID_MARKET',
      severity: 'BLOCK',
      detail:
        'No enabled buyer destination-country policy currently applies to any candidate',
    };
  }

  if (candidateDestinationCodes.length === 0) {
    return {
      reasonCode: 'NO_VALID_MARKET',
      severity: 'BLOCK',
      detail:
        'This candidate has no intended destination-country code recorded',
    };
  }

  const enabled = new Set(buyerDestinationPolicy.countryCodes);
  const unauthorized = candidateDestinationCodes.filter(
    (code) => !enabled.has(code),
  );

  if (unauthorized.length > 0) {
    return {
      reasonCode: 'NO_VALID_MARKET',
      severity: 'BLOCK',
      detail: `Candidate destination(s) ${unauthorized.join(', ')} are outside the currently enabled buyer destination-country policy`,
    };
  }

  return null;
}

function matchesKeyword(
  haystack: string,
  keywords: readonly string[],
): string | undefined {
  const lower = haystack.toLowerCase();

  return keywords.find((keyword) => lower.includes(keyword));
}

export function checkProhibitedCategory(
  feed: FeedSnapshot,
): RuleFinding | null {
  const match =
    matchesKeyword(feed.category, PROHIBITED_CATEGORY_KEYWORDS) ??
    matchesKeyword(feed.name, PROHIBITED_CATEGORY_KEYWORDS);

  if (match === undefined) return null;

  return {
    reasonCode: 'POLICY_BLOCKED',
    severity: 'BLOCK',
    detail: `Matched conservative exclusion keyword "${match}"`,
  };
}

export function checkCounterfeitSignalCheap(
  feed: FeedSnapshot,
): RuleFinding | null {
  const brandMatch = matchesKeyword(feed.name, PROTECTED_BRAND_DENYLIST);

  if (brandMatch !== undefined) {
    return {
      reasonCode: 'COUNTERFEIT_HIGH_CONFIDENCE',
      severity: 'BLOCK',
      detail: `Listing name contains protected brand "${brandMatch}" with no authorization evidence`,
    };
  }

  const signalMatch = matchesKeyword(feed.name, COUNTERFEIT_SIGNAL_KEYWORDS);

  if (signalMatch !== undefined) {
    return {
      reasonCode: 'COUNTERFEIT_HIGH_CONFIDENCE',
      severity: 'ATTENTION',
      detail: `Listing name contains suspicious wording "${signalMatch}"`,
    };
  }

  return null;
}

export function checkPriceBoundsCheap(feed: FeedSnapshot): RuleFinding | null {
  if (feed.priceUsdCents === null) {
    return {
      reasonCode: 'INSUFFICIENT_PRODUCT_DATA',
      severity: 'ATTENTION',
      detail: 'Supplier price could not be read from the CJ feed',
    };
  }

  if (
    feed.priceUsdCents < MIN_PRICE_USD_CENTS ||
    feed.priceUsdCents > MAX_PRICE_USD_CENTS
  ) {
    return {
      reasonCode: 'INVALID_PRICE',
      severity: 'BLOCK',
      detail: `Supplier price ${(feed.priceUsdCents / 100).toFixed(2)} USD is outside the configured valid range`,
    };
  }

  return null;
}

export function runScreening(
  feed: FeedSnapshot,
  marketInput: MarketValidationInput,
): RuleFinding[] {
  return [
    checkValidMarket(marketInput),
    checkProhibitedCategory(feed),
    checkCounterfeitSignalCheap(feed),
    checkPriceBoundsCheap(feed),
  ].filter((finding): finding is RuleFinding => finding !== null);
}
