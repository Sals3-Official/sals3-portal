import type { CandidateEvidence } from '@/lib/cj/evidence';
import { feedSnapshotSchema } from '@/modules/catalog/candidates/rules/contracts';

/**
 * Product name for one candidate row: the CJ evidence name, else the
 * discovery feed snapshot's name, else the raw provider id.
 *
 * The feed-snapshot step carries almost all of the weight. `evidence` comes
 * from the separate per-product detail fetch and exists for a tiny fraction
 * of candidates, while `candidate_evaluations.feed_snapshot` is written for
 * EVERY candidate at discovery time from its `/product/list` row. Reading
 * evidence alone therefore rendered the numeric provider id as the product
 * name on almost every row of every pipeline tab, even though the real name
 * was already stored one column over. Measured against production
 * 2026-08-12: 19 of 87,966 candidates had evidence, while 87,966 of 87,966
 * evaluations had a real feed-snapshot name (zero null, zero placeholder).
 *
 * Takes the row rather than loose fields so a caller cannot reintroduce the
 * bug by forgetting to pass the snapshot.
 */
export function displayName(candidate: {
  externalProductId: string;
  evidence: CandidateEvidence | null;
  evaluation: { feedSnapshot: unknown };
}): string {
  if (candidate.evidence !== null && candidate.evidence.name !== '') {
    return candidate.evidence.name;
  }

  // `feed_snapshot` is `jsonb`, so it reaches here untyped - parse, never cast.
  const feed = feedSnapshotSchema.safeParse(candidate.evaluation.feedSnapshot);

  if (feed.success && feed.data.name !== '') return feed.data.name;

  return candidate.externalProductId;
}

/**
 * Supplier price in USD for one candidate row: the CJ evidence price, else the
 * discovery feed snapshot's price, else unknown.
 *
 * Same shape as `displayName`, and for the same reason - the price the table
 * showed came from `evidence`, which exists for a tiny fraction of candidates,
 * so almost every row rendered a dash. The price was never missing: screening
 * decides `INVALID_PRICE` from `feed.priceUsdCents` (see
 * `rules/screening.ts`), so the evaluator was rejecting rows on a price the
 * table would not display. Measured against production 2026-08-12: 87,966 of
 * 87,966 evaluations carry a feed price, and on the one row where both sources
 * existed they agreed exactly (evidence `4.04`, feed `404` cents).
 *
 * Note the unit change: evidence stores USD, the feed snapshot stores cents.
 */
export function supplierPriceUsd(candidate: {
  evidence: CandidateEvidence | null;
  evaluation: { feedSnapshot: unknown };
}): number | null {
  if (
    candidate.evidence !== null &&
    candidate.evidence.supplierPriceUsd !== null
  ) {
    return candidate.evidence.supplierPriceUsd;
  }

  // `feed_snapshot` is `jsonb`, so it reaches here untyped - parse, never cast.
  const feed = feedSnapshotSchema.safeParse(candidate.evaluation.feedSnapshot);

  if (feed.success && feed.data.priceUsdCents !== null) {
    return feed.data.priceUsdCents / 100;
  }

  return null;
}

export function totalStock(evidence: CandidateEvidence | null): number | null {
  if (evidence === null) return null;

  const known = evidence.variants
    .map((variant) => variant.totalInventory)
    .filter((value): value is number => value !== null);

  return known.length === 0
    ? null
    : known.reduce((sum, value) => sum + value, 0);
}

/**
 * Countries where CJ reports observed stock. This proves a stocked origin
 * exists, never that Sals3 confirmed a usable freight route there (ADR-013).
 */
export function stockedOrigins(evidence: CandidateEvidence | null): string {
  if (evidence === null) return '—';

  const stocked = evidence.warehouses.filter(
    (warehouse) => (warehouse.totalInventory ?? 0) > 0,
  );

  return stocked.length === 0
    ? '—'
    : stocked.map((warehouse) => warehouse.name).join(', ');
}

/**
 * Product image address for one candidate row, from the discovery feed
 * snapshot. Evidence stores only `usableImageCount`, never an address, so the
 * feed snapshot is the only image source. The address was allow-listed to the
 * CJ image hosts at intake (`cjImageUrl`), matching `next.config.ts`
 * `remotePatterns`.
 */
export function imageUrl(candidate: {
  evaluation: { feedSnapshot: unknown };
}): string | null {
  // `feed_snapshot` is `jsonb`, so it reaches here untyped - parse, never cast.
  const feed = feedSnapshotSchema.safeParse(candidate.evaluation.feedSnapshot);

  return feed.success ? (feed.data.imageUrl ?? null) : null;
}

export function formatUsd(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(2)}`;
}

export function formatStock(value: number | null): string {
  return value === null ? '—' : String(value);
}
