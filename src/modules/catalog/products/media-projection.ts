import { and, eq, inArray } from 'drizzle-orm';
import {
  candidateEvaluations,
  productMediaSources,
  supplierSnapshots,
} from '@/lib/db/schema';
import { cjImageUrl } from '@/lib/cj/primitives';
import { feedSnapshotSchema } from '@/modules/catalog/candidates/rules/contracts';
import type { Executor } from '@/modules/catalog/candidates/repository';

/**
 * Projects observed supplier image URLs into `product_media_sources`.
 *
 * ## Why a projection instead of reading the evidence directly
 *
 * The storefront could have read `candidate_evaluations.feed_snapshot.imageUrl`
 * — it is the only image in the database, and it is what the Product Sourcing
 * "Ready" tab already displays. That was rejected for three reasons:
 *
 * - `feed_snapshot` hangs off the seller-scoped screening tables, which carry
 *   no publication state. A public query joined to them could not express
 *   "PUBLISHED only" in its own `WHERE`.
 * - `rights_basis` and `review_state` exist on this table precisely so a
 *   supplier asset is never served without a recorded basis (ADR-011 §6).
 *   Reading around them would publish one with no record at all.
 * - Retrofitting provenance onto live media rows later is the expensive
 *   migration ADR-016 was written to prevent.
 *
 * So the same bytes, at the same URL, reach a buyer — they just travel through
 * a row that says where they came from, when they were observed, and under
 * which right they may be shown.
 *
 * ## Two sources, best first
 *
 * 1. `supplier_snapshots.evidence.imageUrls` — the full allow-listed set from
 *    a real CJ detail fetch (`cj-evidence-v3`). This is what makes a gallery
 *    possible.
 * 2. `candidate_evaluations.feed_snapshot.imageUrl` — a single image written at
 *    discovery time. The fallback, so a product whose evidence has not been
 *    captured yet still has one honest photo.
 *
 * ## What it never writes
 *
 * No `checksum`, `content_type`, `byte_size`, or dimensions: no bytes are
 * fetched here, and a checksum over a URL is not a checksum of the file. No
 * `merchant_center_eligible` either — null means never checked, which is not
 * the same as eligible (ADR-016 §4).
 */

/** Rights basis for CJ product imagery, declared by the owner on 2026-08-13. */
export type MediaRightsDecision = {
  rightsBasis: 'SUPPLIER_TERMS' | 'SELLER_DECLARED';
  reviewState: 'APPROVED' | 'NOT_REVIEWED';
};

export type MediaProjectionResult = {
  inserted: number;
  /** Already present, or rejected by the host allow-list. */
  skipped: number;
  source: 'DETAIL_EVIDENCE' | 'FEED_SNAPSHOT' | 'NONE';
};

/**
 * Bounds one product's gallery. CJ can return long image sets; a product page
 * that renders 40 thumbnails is a page nobody scrolls and a row count nobody
 * reviews.
 */
const MAX_IMAGES_PER_PRODUCT = 12;

/**
 * Re-validates a stored URL against the CJ host allow-list.
 *
 * The URL was allow-listed when the evidence was captured, and it is
 * allow-listed again here. That is not redundant: this row is what the public
 * storefront will serve, and a stored string is data, not a promise. The same
 * list appears in three places by necessity — `lib/cj/image-hosts.ts`,
 * `next.config.ts`'s `remotePatterns`, and `sals3-ecommerce`'s
 * `PRODUCT_IMAGE_HOSTS` — and all three must agree.
 */
function allowedImageUrl(value: unknown): string | null {
  const parsed = cjImageUrl.safeParse(value);

  return parsed.success ? parsed.data : null;
}

type ObservedImages = {
  urls: string[];
  observedAt: Date;
  source: 'DETAIL_EVIDENCE' | 'FEED_SNAPSHOT';
};

/**
 * The image URLs and their observation time. Reads the two evidence rows
 * directly rather than through a schema for the whole evidence document: only
 * these two fields are needed, and an older `cj-evidence-v2` snapshot simply
 * has no `imageUrls`, which must degrade to the feed fallback rather than
 * throw.
 */
async function findObservedImages(
  executor: Executor,
  candidateId: string,
): Promise<ObservedImages | null> {
  const snapshots = await executor
    .select({
      evidence: supplierSnapshots.evidence,
      capturedAt: supplierSnapshots.capturedAt,
    })
    .from(supplierSnapshots)
    .where(eq(supplierSnapshots.candidateId, candidateId))
    .limit(1);
  const snapshot = snapshots[0];
  const evidence = snapshot?.evidence as { imageUrls?: unknown } | null;
  const fromEvidence = Array.isArray(evidence?.imageUrls)
    ? evidence.imageUrls
        .map(allowedImageUrl)
        .filter((url): url is string => url !== null)
    : [];

  if (fromEvidence.length > 0 && snapshot !== undefined) {
    return {
      urls: fromEvidence.slice(0, MAX_IMAGES_PER_PRODUCT),
      observedAt: snapshot.capturedAt,
      source: 'DETAIL_EVIDENCE',
    };
  }

  const evaluations = await executor
    .select({
      feedSnapshot: candidateEvaluations.feedSnapshot,
      evaluatedAt: candidateEvaluations.evaluatedAt,
      updatedAt: candidateEvaluations.updatedAt,
    })
    .from(candidateEvaluations)
    .where(eq(candidateEvaluations.candidateId, candidateId))
    .limit(1);
  const evaluation = evaluations[0];

  if (evaluation === undefined) return null;

  const feed = feedSnapshotSchema.safeParse(evaluation.feedSnapshot);
  const url = feed.success ? allowedImageUrl(feed.data.imageUrl) : null;

  if (url === null) return null;

  return {
    urls: [url],
    // The evaluation's own observation time, never `now()`: claiming this
    // image was seen at insert time would overstate how fresh it is.
    observedAt: evaluation.evaluatedAt ?? evaluation.updatedAt,
    source: 'FEED_SNAPSHOT',
  };
}

export default async function projectSupplierMediaForProduct(
  executor: Executor,
  input: {
    productId: string;
    candidateId: string;
    actorId: string;
    rights: MediaRightsDecision;
  },
): Promise<MediaProjectionResult> {
  const observed = await findObservedImages(executor, input.candidateId);

  if (observed === null) {
    return { inserted: 0, skipped: 0, source: 'NONE' };
  }

  // Dedupe against what is already recorded. The unique index on
  // `(product_id, checksum)` only covers checksummed rows, and these have no
  // checksum, so uniqueness by URL is enforced here.
  const existing = await executor
    .select({ sourceUrl: productMediaSources.sourceUrl })
    .from(productMediaSources)
    .where(
      and(
        eq(productMediaSources.productId, input.productId),
        inArray(productMediaSources.sourceUrl, observed.urls),
      ),
    );
  const alreadyStored = new Set(
    existing
      .map((row) => row.sourceUrl)
      .filter((url): url is string => url !== null),
  );
  const fresh = observed.urls.filter((url) => !alreadyStored.has(url));

  if (fresh.length === 0) {
    return {
      inserted: 0,
      skipped: observed.urls.length,
      source: observed.source,
    };
  }

  await executor.insert(productMediaSources).values(
    fresh.map((url) => ({
      productId: input.productId,
      // Product-level, not variant-level: CJ's image set is not keyed to a
      // `vid`, so attributing a photo to one variant would be a guess.
      variantId: null,
      sourceType: 'SUPPLIER_ORIGINAL' as const,
      sourceUrl: url,
      rightsBasis: input.rights.rightsBasis,
      reviewState: input.rights.reviewState,
      observedAt: observed.observedAt,
      createdBy: input.actorId,
    })),
  );

  return {
    inserted: fresh.length,
    skipped: observed.urls.length - fresh.length,
    source: observed.source,
  };
}
