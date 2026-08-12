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

/**
 * `categoryId` and the display fields below are deliberately NOT part of
 * `computeFingerprint`. The fingerprint decides whether a product must be
 * re-screened; adding fields to it would requeue the entire existing pipeline
 * the first time discovery ran again, for data no versioned rule reads. The
 * category LABEL already covers the rule-relevant case.
 */
export function toFeedSnapshot(product: CjProduct): FeedSnapshot {
  return {
    name: product.name,
    category: product.category,
    categoryId: product.categoryId ?? null,
    priceUsdCents: product.priceCentsUsd,
    listedCount: product.listedCount,
    shipsFrom: product.shipsFrom,
    sku: product.sku,
    imageUrl: product.imageUrl,
    weight: product.weight,
    productType: product.productType,
    supplierName: product.supplier,
    freeShipping: product.freeShipping,
    providerCreatedAt: product.createdAt,
  };
}
