import { createHash } from 'crypto';
import type { CjProduct } from '@/lib/cj/normalize';
import type { FeedSnapshot } from './rules/contracts';

/**
 * Cheap hash of the CJ feed fields that matter for "has this changed since
 * we last looked" (spec's ingestion step). Comparing this avoids re-queueing
 * - and re-spending CJ evidence points on - a candidate whose feed data is
 * unchanged since its last evaluation.
 */
export function computeFingerprint(product: CjProduct): string {
  const canonical = JSON.stringify([
    product.id,
    product.category,
    product.priceCentsUsd,
    product.listedCount,
  ]);

  return createHash('sha256').update(canonical).digest('hex');
}

export function toFeedSnapshot(product: CjProduct): FeedSnapshot {
  return {
    name: product.name,
    category: product.category,
    priceUsdCents: product.priceCentsUsd,
    listedCount: product.listedCount,
    shipsFrom: product.shipsFrom,
  };
}
