import { createHash } from 'crypto';
import type { CjProduct } from '@/lib/cj/normalize';
import type { FeedSnapshot } from './rules/contracts';

/**
 * MATERIAL-change fingerprint (ADR-010 §12.5): includes every feed field
 * that can change a rule outcome - normalized name, provider category
 * identity, price, and shipping-origin hints - and deliberately EXCLUDES
 * popularity-only `listedCount`, which is a ranking signal no versioned
 * rule reads. A popularity-only change must not spend qualification calls;
 * a name/category/price/origin change must trigger re-evaluation.
 */
export function computeFingerprint(product: CjProduct): string {
  const canonical = JSON.stringify([
    product.id,
    product.name,
    product.category,
    product.priceCentsUsd,
    [...product.shipsFrom].sort(),
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
