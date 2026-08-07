/**
 * Placeholder business/legal policy for automated candidate evaluation.
 *
 * NONE of the values below are an approved ADR-002 pilot rule pack or an
 * approved ADR-003 destination market - see `hot.md`'s "single
 * highest-leverage open item" and spec section 14.1. They exist so the
 * automation engine produces a real decision today instead of defaulting
 * every candidate to `NOT_IN_PILOT`/hold forever. Bump `POLICY_VERSION`
 * whenever any value below changes, so a stored decision can always be
 * traced to the policy that produced it.
 */

export const POLICY_VERSION = 'catalog-eval-policy-placeholder-v1';

/** Bump when `CandidateEvidence`'s shape changes, so old snapshot rows stay readable. */
export const EVIDENCE_SCHEMA_VERSION = 'cj-evidence-v1';

/**
 * The only enabled market today - matches the existing
 * `PLACEHOLDER_MARKET_CODE` in `src/app/(portal)/products/actions.ts`. Not an
 * ADR-003 approval.
 */
export const PLACEHOLDER_MARKET_CODE = 'PH';

/**
 * Category/product-name keyword denylist, verbatim from spec section 14.1's
 * own "recommended initial exclusions" list - not invented here. A match
 * blocks at the screening stage, before any CJ evidence-fetch point is
 * spent.
 */
export const PROHIBITED_CATEGORY_KEYWORDS: readonly string[] = [
  'weapon',
  'gun',
  'knife',
  'firearm',
  'ammo',
  'ammunition',
  'tobacco',
  'vape',
  'vaping',
  'e-cigarette',
  'nicotine',
  'supplement',
  'medicine',
  'pharmaceutical',
  'drug',
  'cosmetic',
  'food',
  'snack',
  'beverage',
  'battery',
  'charger',
  'electrical',
  'power bank',
  'pesticide',
  'chemical',
  'seed',
  'plant',
  'live animal',
  'adult',
  'sex toy',
  'telecom',
  'signal jammer',
  'precious metal',
  'gold bullion',
  'silver bullion',
];

/**
 * Exact protected-brand names. Deliberately short and unambiguous: a hit
 * here is `BLOCKED`, so the list stays conservative rather than broad. This
 * is NOT a claim that software can verify authenticity - see
 * `COUNTERFEIT_SIGNAL_KEYWORDS` for the non-blocking signal tier.
 */
export const PROTECTED_BRAND_DENYLIST: readonly string[] = [
  'nike',
  'adidas',
  'apple',
  'samsung',
  'gucci',
  'louis vuitton',
  'rolex',
  'chanel',
];

/** Weaker signals -> PASS_WITH_ATTENTION, never BLOCKED on their own. */
export const COUNTERFEIT_SIGNAL_KEYWORDS: readonly string[] = [
  'replica',
  'inspired by',
  'aaa quality',
  '1:1',
  'knockoff',
  'fake',
];

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number.parseInt(raw, 10);

  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Placeholder price bounds in USD cents. Not an approved commercial rule. */
export const MIN_PRICE_USD_CENTS = envInt('CATALOG_MIN_PRICE_USD_CENTS', 100);
export const MAX_PRICE_USD_CENTS = envInt(
  'CATALOG_MAX_PRICE_USD_CENTS',
  50_000,
);

/**
 * Placeholder margin estimate. Reuses the existing (already-labelled
 * prototype) `CJ_PRICE_MARKUP_PERCENT` env var minus a placeholder overhead
 * estimate, because no real retail price or landed-cost model exists yet
 * (spec section 13 - pricing is a Product Editor concern this feature does
 * not touch). This produces the SAME estimate for every candidate today; it
 * is not product-differentiated, and is an attention signal only, never a
 * real margin calculation.
 */
export const PRICE_MARKUP_PERCENT = envInt('CJ_PRICE_MARKUP_PERCENT', 30);
export const ESTIMATED_OVERHEAD_PERCENT = envInt(
  'CATALOG_ESTIMATED_OVERHEAD_PERCENT',
  20,
);
export const MIN_MARGIN_PERCENT = envInt('CATALOG_MIN_MARGIN_PERCENT', 10);

export function estimatedMarginPercent(): number {
  return PRICE_MARKUP_PERCENT - ESTIMATED_OVERHEAD_PERCENT;
}

export const ABNORMAL_PRICE_CHANGE_PERCENT = envInt(
  'CATALOG_ABNORMAL_PRICE_CHANGE_PERCENT',
  30,
);

export const MAX_EVALUATION_ATTEMPTS = 5;
export const EVALUATION_BATCH_SIZE = 8;
export const LEASE_DURATION_MS = 5 * 60 * 1000;
export const RETRY_BACKOFF_BASE_MS = 30_000;
export const RETRY_BACKOFF_MAX_MS = 60 * 60 * 1000;
export const RETRY_JITTER_MS = 15_000;

/** Exponential backoff with jitter, capped at RETRY_BACKOFF_MAX_MS. */
export function nextRetryDelayMs(attemptCount: number): number {
  const exponential =
    RETRY_BACKOFF_BASE_MS * 2 ** Math.max(0, attemptCount - 1);
  const capped = Math.min(RETRY_BACKOFF_MAX_MS, exponential);

  return capped + Math.random() * RETRY_JITTER_MS;
}
