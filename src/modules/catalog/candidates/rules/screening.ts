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
 * Checks #1 (prohibited category) and #2 (destination-country restriction)
 * from the requested rule list collapse into one check today: with only one
 * placeholder market and no ADR-003-approved country matrix, there is no
 * honest way to differentiate "blocked everywhere" from "blocked in this
 * market" yet. `COUNTRY_RESTRICTED` stays a reserved, unused reason code
 * until a second market exists with different category rules.
 */

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

export function runScreening(feed: FeedSnapshot): RuleFinding[] {
  return [
    checkProhibitedCategory(feed),
    checkCounterfeitSignalCheap(feed),
    checkPriceBoundsCheap(feed),
  ].filter((finding): finding is RuleFinding => finding !== null);
}
