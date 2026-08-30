import type { CandidateEvidence } from '@/lib/cj/evidence';
import CJ_IMAGE_HOSTS from '@/lib/cj/image-hosts';
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
 * feed snapshot is the only image source.
 *
 * ## Why the host check is here and not only at intake
 *
 * This function used to say the address "was allow-listed at intake" and stop
 * there. That was an assertion about a different code path, not a property of
 * this one. Three facts make the difference load-bearing:
 *
 * - `feedSnapshotSchema.imageUrl` is a plain `z.string().nullish()` - the
 *   `cjImageUrl` gate runs on the discovery WRITE path only, so nothing
 *   re-checks the host when the row is read back.
 * - `next.config.ts` sets `images.loader: 'custom'`, which bypasses
 *   `/_next/image` entirely, so `remotePatterns` enforces nothing at request
 *   time.
 * - `cjImageLoader` returns a non-CJ address unchanged, by design.
 *
 * So whatever string reaches this function becomes a browser `GET` from the
 * seller's session. A manual `UPDATE`, a backfill, a script, or a future ingest
 * path that builds a feed snapshot without `toFeedSnapshot` would all reach the
 * browser unchecked. Re-checking here costs three lines and closes it for every
 * caller at once.
 */
export function imageUrl(candidate: {
  evaluation: { feedSnapshot: unknown };
}): string | null {
  // `feed_snapshot` is `jsonb`, so it reaches here untyped - parse, never cast.
  const feed = feedSnapshotSchema.safeParse(candidate.evaluation.feedSnapshot);

  if (!feed.success) return null;

  const address = feed.data.imageUrl;

  if (address === null || address === undefined || address === '') return null;

  try {
    const url = new URL(address);

    return url.protocol === 'https:' && CJ_IMAGE_HOSTS.includes(url.hostname)
      ? address
      : null;
  } catch {
    // Not an absolute address at all. Relative paths are never CJ imagery.
    return null;
  }
}

export function formatUsd(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(2)}`;
}

export function formatStock(value: number | null): string {
  return value === null ? '—' : String(value);
}

/**
 * CJ's own SKU for one candidate row, from the discovery feed snapshot.
 *
 * `sku` is one of the display fields added on 2026-08-12 as `nullish` with no
 * backfill, so a row discovered before that date carries `null` and there is
 * nothing to render. That is why this returns `null` rather than a placeholder
 * string: the caller shows the identifier it does have (the provider product
 * id) instead of a dash standing in for a value that was never captured.
 */
export function cjSku(candidate: {
  evaluation: { feedSnapshot: unknown };
}): string | null {
  // `feed_snapshot` is `jsonb`, so it reaches here untyped - parse, never cast.
  const feed = feedSnapshotSchema.safeParse(candidate.evaluation.feedSnapshot);

  if (!feed.success) return null;

  const sku = feed.data.sku?.trim() ?? '';

  return sku === '' ? null : sku;
}

/**
 * How many other sellers the feed says list this product.
 *
 * Shown, never used to rank. ADR-012 treats `listedNum` as a gated ranking
 * input that needs category normalisation before it can order anything; a
 * seller reading one row's number is a different and much smaller claim.
 */
export function listedCount(candidate: {
  evaluation: { feedSnapshot: unknown };
}): number | null {
  const feed = feedSnapshotSchema.safeParse(candidate.evaluation.feedSnapshot);

  return feed.success ? (feed.data.listedCount ?? null) : null;
}

/**
 * The origins the discovery feed reported for this product.
 *
 * Deliberately NOT `stockedOrigins`, which reads `evidence` — present on a tiny
 * fraction of candidates — and answers a stronger question (CJ observed stock
 * there). This is the feed's own shipping-origin list, which every row has, and
 * it asserts only where the product ships from. Neither one proves a freight
 * route to a buyer destination exists.
 */
export function feedOrigins(candidate: {
  evaluation: { feedSnapshot: unknown };
}): string[] {
  const feed = feedSnapshotSchema.safeParse(candidate.evaluation.feedSnapshot);

  if (!feed.success) return [];

  return feed.data.shipsFrom
    .map((origin) => origin.trim())
    .filter((o) => o !== '');
}

/** Whether the feed flagged this product as free shipping. Absent reads as false. */
export function feedFreeShipping(candidate: {
  evaluation: { feedSnapshot: unknown };
}): boolean {
  const feed = feedSnapshotSchema.safeParse(candidate.evaluation.feedSnapshot);

  return feed.success && feed.data.freeShipping === true;
}

/**
 * How a provider-feed sighting reads on a row, and whether it is stale.
 *
 * A raw timestamp is what the pipeline shipped with, and it hid the problem it
 * was meant to expose: every row of a 30 August screen read `8/20`, which is a
 * date rather than a judgement. Relative age plus an explicit stale flag says
 * the thing the date was carrying silently.
 *
 * `now` is an argument rather than read inside, so a test states the instant it
 * is asserting against instead of racing the clock.
 */
export function feedSighting(
  lastSeenAt: Date | string | null,
  now: Date,
  staleAfterDays: number,
): { label: string; stale: boolean } {
  if (lastSeenAt === null) return { label: 'Never seen', stale: true };

  const seen = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);

  if (Number.isNaN(seen.getTime())) return { label: 'Never seen', stale: true };

  const days = Math.floor(
    (now.getTime() - seen.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (days <= 0) return { label: 'Today', stale: false };

  return {
    label: days === 1 ? '1 day ago' : `${days} days ago`,
    stale: days > staleAfterDays,
  };
}
