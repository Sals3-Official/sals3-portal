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

export function formatUsd(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(2)}`;
}

export function formatStock(value: number | null): string {
  return value === null ? '—' : String(value);
}
