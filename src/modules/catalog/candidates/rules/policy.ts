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

/**
 * Composes the catalog evaluation policy version with the buyer-destination
 * policy version that was actually in effect for one evaluation, into one
 * deterministic, storable identity (Codex review fix) - written to
 * `candidate_evaluations.policy_version` instead of the bare catalog
 * version alone, and carried into the audit payload. Equal inputs always
 * produce an equal string and different buyer-destination versions always
 * produce a different one, so a future policy-version-change re-evaluation
 * job can detect "this row was decided under an older buyer-destination
 * policy" by string comparison alone - no second column or migration
 * needed. That re-evaluation job itself is not implemented here.
 */
export function composeEvaluationPolicyVersion(
  catalogPolicyVersion: string,
  buyerDestinationPolicyVersion: string,
): string {
  return `${catalogPolicyVersion}+buyer-destination:${buyerDestinationPolicyVersion}`;
}

/**
 * Bump when `CandidateEvidence`'s shape changes, so old snapshot rows stay
 * readable. `v2` (2026-08-10, ADR-013): each variant's stock is now
 * `stockByOrigin[]` (raw `cjInventory`/`factoryInventory`/`totalInventory`/
 * `verifiedWarehouse` per country) plus a derived `stockEvidence` label,
 * instead of a bare summed `totalInventory`.
 */
export const EVIDENCE_SCHEMA_VERSION = 'cj-evidence-v2';

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

/**
 * Freshness tiers (ADR-010 §12.2): when a decision's evidence must be
 * reconciled again. Selected/imported/live/order-linked products get
 * webhook-driven updates plus daily reconciliation once that linkage
 * exists; qualified-but-unselected products refresh within 72 hours; other
 * operational nonterminal products within 30 days. Permanent policy blocks
 * return `null` - they re-evaluate only when supplier data or the relevant
 * policy/evidence version changes, never on a clock.
 */
export function nextRefreshAtFor(
  status:
    | 'QUEUED'
    | 'EVALUATING'
    | 'PASS'
    | 'PASS_WITH_ATTENTION'
    | 'TEMPORARILY_INELIGIBLE'
    | 'BLOCKED'
    | 'EVALUATION_FAILED',
  now: Date = new Date(),
): Date | null {
  const hours = (n: number) => new Date(now.getTime() + n * 60 * 60 * 1000);

  switch (status) {
    case 'PASS':
    case 'PASS_WITH_ATTENTION':
      // Qualified but unselected: reconcile at least every 72 hours. (No
      // selected/imported/live linkage exists yet; once it does, those rows
      // move to the daily tier.)
      return hours(72);
    case 'TEMPORARILY_INELIGIBLE':
    case 'EVALUATION_FAILED':
      // Operational nonterminal: retries handle the near term; the 30-day
      // freshness floor guarantees even an exhausted row is reconciled and
      // can reopen (ADR-010 §12.7 - a dead letter is not a blind spot).
      return hours(30 * 24);
    case 'BLOCKED':
      return null;
    default:
      return null;
  }
}

/**
 * Deferral delay when an evidence fetch hits rate/points pressure (a real
 * provider 429, or the shared limiter refusing a slot under concurrency).
 * ADR-013 §5: that is recoverable connection health, never a technical
 * attempt against the product - the row waits out roughly one documented
 * per-minute replenishment window and retries with its attempt budget
 * intact.
 */
export const RATE_LIMIT_DEFER_MS = 15 * 60 * 1000;

export const MAX_EVALUATION_ATTEMPTS = 5;
/**
 * Lowered from 8 on 2026-08-08: paired with `MAX_PAGES_PER_TICK_PER_CONNECTION`,
 * the tick was consistently exceeding the evaluate-tick route's 60s
 * `maxDuration` and getting killed mid-batch by Vercel
 * (`FUNCTION_INVOCATION_TIMEOUT`, seen twice in a row against
 * production) - at ~3.5s of sequential, rate-limited CJ evidence
 * fetching per candidate, 8 alone accounted for ~28s before ingestion's
 * own CJ calls. A smaller batch finishes reliably inside the limit;
 * total evaluation throughput is unaffected since the schedule ticks
 * every 5 minutes regardless.
 */
export const EVALUATION_BATCH_SIZE = 4;
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
