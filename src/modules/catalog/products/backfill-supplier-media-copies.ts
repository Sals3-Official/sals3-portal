import 'server-only';

import { and, asc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import { productMediaSources, products } from '@/lib/db/schema';
import mirrorSupplierMediaForProduct from './mirror-supplier-media';

/**
 * The sweeper for products whose supplier photos were recorded before mirroring
 * existed.
 *
 * Publication mirrors from now on, but every already-published product still
 * points at CJ's CDN — and those are exactly the products a buyer can order
 * today, so they are the ones whose orders ADR-007's `Media locking` promise is
 * currently broken for. This walks them, oldest first, in bounded batches.
 *
 * ## Why a manual sweep and not a cron
 *
 * ADR-013 §12's no-cron rule aside, there is nothing to poll: the set only
 * shrinks. Each run is triggered by hand, reports what it did, and can simply be
 * run again until `remaining` reaches zero. That also keeps a large one-off
 * bandwidth spend under a human's control rather than a schedule's.
 *
 * **No CJ API call and no points** (ADR-017) — this reads CJ's CDN.
 */

/**
 * Products per run. Twelve images each at up to 5 MB is the worst case, so a
 * batch of ten is bounded well inside a serverless invocation's time and memory
 * while still finishing a small catalogue in one or two presses.
 */
export const BACKFILL_PRODUCT_BATCH = 10;

export type BackfillSupplierMediaResult = {
  productsVisited: number;
  mirrored: number;
  skipped: number;
  failures: { productId: string; mediaId: string; reason: string }[];
  /** Products still holding at least one unmirrored approved supplier photo. */
  remaining: number;
};

/** The predicate that defines "needs a durable copy", used twice below. */
function needsMirroring() {
  return and(
    eq(productMediaSources.sourceType, 'SUPPLIER_ORIGINAL'),
    eq(productMediaSources.reviewState, 'APPROVED'),
    ne(productMediaSources.rightsBasis, 'UNKNOWN'),
    isNotNull(productMediaSources.sourceUrl),
    isNull(productMediaSources.storedUrl),
  );
}

export default async function backfillSupplierMediaCopies(
  options: { db?: Database; limit?: number } = {},
): Promise<BackfillSupplierMediaResult> {
  const db = options.db ?? getDb();
  const limit = options.limit ?? BACKFILL_PRODUCT_BATCH;

  // Published first and oldest first: a live product's orders are the ones the
  // promise is broken for right now, and the oldest listing is the one most
  // likely to have had its supplier file replaced already.
  const pending = await db
    .selectDistinct({
      productId: productMediaSources.productId,
      publishedAt: products.publishedAt,
    })
    .from(productMediaSources)
    .innerJoin(products, eq(products.id, productMediaSources.productId))
    .where(and(needsMirroring(), isNotNull(products.publishedAt)))
    .orderBy(asc(products.publishedAt))
    .limit(limit);

  const result: BackfillSupplierMediaResult = {
    productsVisited: 0,
    mirrored: 0,
    skipped: 0,
    failures: [],
    remaining: 0,
  };

  // eslint-disable-next-line no-restricted-syntax -- sequential: each product opens CDN reads, and parallelism here would hammer a shared host.
  for (const row of pending) {
    // eslint-disable-next-line no-await-in-loop
    const mirrored = await mirrorSupplierMediaForProduct({
      productId: row.productId,
      db,
    });

    result.productsVisited += 1;
    result.mirrored += mirrored.mirrored;
    result.skipped += mirrored.skipped;
    result.failures.push(
      ...mirrored.failures.map((failure) => ({
        productId: row.productId,
        mediaId: failure.mediaId,
        reason: failure.reason,
      })),
    );
  }

  // Counted after the run, so the number an operator reads is what is genuinely
  // left rather than what was left when the run started.
  const [remaining] = await db
    .select({
      count: sql<number>`count(distinct ${productMediaSources.productId})`,
    })
    .from(productMediaSources)
    .innerJoin(products, eq(products.id, productMediaSources.productId))
    .where(and(needsMirroring(), isNotNull(products.publishedAt)));

  result.remaining = Number(remaining?.count ?? 0);

  return result;
}
