import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { and, count, eq } from 'drizzle-orm';
import getDb, { type DbExecutor } from '@/lib/db/client';
import { productReviewPhotos, productReviews } from '@/lib/db/schema/reviews';
import { getR2Client, readR2Config } from '@/lib/storage/r2-client';
import { r2PublicImageUrl, r2PublicUrlForKey } from '@/lib/storage/r2-url';
import {
  OUTPUT_CONTENT_TYPE,
  prepareUploadedImage,
} from '@/modules/catalog/products/image-upload-pipeline';
import { MAX_REVIEW_PHOTOS } from './contracts';

/**
 * One buyer photo onto one of that buyer's own reviews.
 *
 * ## The seller pipeline does the deciding, not a second copy of it
 *
 * `prepareUploadedImage` is the same validate-and-re-encode step behind every
 * seller upload: it reads the file's own magic number rather than the
 * browser-supplied `File.type` (rule 30 — a request can claim any type it
 * likes), refuses anything past the size or dimension ceiling, and re-encodes
 * to WebP. That last part earns its keep more here than for a seller: a buyer
 * is an anonymous member of the public, and what lands in the bucket is an
 * image this server produced from their bytes rather than the file they named.
 *
 * A second copy of those checks would be a second thing to keep in step, and
 * the one that drifted would be the one accepting a file the other refuses.
 *
 * ## Ownership is checked against the review row, never taken from the path
 *
 * `buyer_email` on the review is the authorisation. A caller holding the
 * storefront bearer token cannot attach a photo to somebody else's review,
 * because the lookup below matches both the id **and** the address, and its
 * failure is the same `NOT_FOUND` an unknown id gets — a distinguishable reply
 * is a way to enumerate which review ids exist.
 *
 * Also `PUBLISHED` only: a review a moderator has already hidden does not get
 * new pictures attached to it.
 *
 * ## Position is counted, and the unique index is what actually decides
 *
 * `count` then `insert` has a window between the two, so two photos posted at
 * once can compute the same position.
 * `sals3_product_review_photos_position_key` makes the loser collide rather
 * than overwrite, and a collision is reported as `LIMIT_REACHED` — which is
 * both what a retry of the same photo means and what a genuine fifth means.
 * Getting that wrong silently would mean one photo replacing another.
 *
 * ## The object is written before the row, and can outlive a failure
 *
 * If the insert fails the object stays in the bucket with nothing pointing at
 * it. The other order — row first, upload after — produces a published review
 * whose photo is a broken image, which a buyer sees and cannot fix. An
 * unreferenced object costs storage; a broken review costs trust.
 */

export type AttachReviewPhotoResult =
  | { ok: true; photoId: string; position: number }
  | { ok: false; reason: 'NOT_FOUND' }
  | { ok: false; reason: 'LIMIT_REACHED' }
  | { ok: false; reason: 'EMPTY_FILE' }
  | { ok: false; reason: 'FILE_TOO_LARGE'; maxBytes: number }
  | { ok: false; reason: 'UNSUPPORTED_FILE_TYPE' }
  | { ok: false; reason: 'DIMENSIONS_TOO_LARGE'; maxDimensionPx: number }
  | { ok: false; reason: 'PROCESSING_FAILED' }
  | { ok: false; reason: 'STORAGE_NOT_CONFIGURED' }
  | { ok: false; reason: 'UPLOAD_FAILED' };

/** Postgres `unique_violation`. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === '23505';
}

export default async function attachReviewPhoto(
  input: { reviewId: string; buyerEmail: string; fileBytes: ArrayBuffer },
  executor: DbExecutor = getDb(),
): Promise<AttachReviewPhotoResult> {
  const buyerEmail = input.buyerEmail.trim().toLowerCase();

  if (buyerEmail === '') return { ok: false, reason: 'NOT_FOUND' };

  const r2Config = readR2Config();

  if (r2Config === null) return { ok: false, reason: 'STORAGE_NOT_CONFIGURED' };

  const review = await executor
    .select({ id: productReviews.id })
    .from(productReviews)
    .where(
      and(
        eq(productReviews.id, input.reviewId),
        eq(productReviews.buyerEmail, buyerEmail),
        eq(productReviews.status, 'PUBLISHED'),
      ),
    )
    .limit(1);

  if (review.length === 0) return { ok: false, reason: 'NOT_FOUND' };

  const existing = await executor
    .select({ total: count() })
    .from(productReviewPhotos)
    .where(eq(productReviewPhotos.reviewId, input.reviewId));

  const position = existing[0]?.total ?? 0;

  // Checked before the expensive decode, so a buyer past the limit is refused
  // without spending a re-encode and an object write on a row that cannot exist.
  if (position >= MAX_REVIEW_PHOTOS)
    return { ok: false, reason: 'LIMIT_REACHED' };

  const processed = await prepareUploadedImage(input.fileBytes);

  if (!processed.ok) return processed;

  // A random key, never a caller-supplied filename or path (rule 31). Under its
  // own prefix so a bucket lifecycle rule can treat buyer photos differently
  // from seller media by path alone.
  const objectKey = `review-media/${input.reviewId}/${randomUUID()}.webp`;

  try {
    await getR2Client(r2Config).send(
      new PutObjectCommand({
        Bucket: r2Config.bucket,
        Key: objectKey,
        Body: processed.buffer,
        ContentType: OUTPUT_CONTENT_TYPE,
      }),
    );
  } catch {
    return { ok: false, reason: 'UPLOAD_FAILED' };
  }

  const verifiedUrl = r2PublicImageUrl.parse(
    r2PublicUrlForKey(r2Config.publicBaseUrl, objectKey),
  );

  // Unreachable while the URL is built from the same `publicBaseUrl` the check
  // itself reads, kept as a hard refusal rather than a silent write: a photo row
  // addressing anything outside the configured base is exactly what the read
  // path's host check exists to catch, and it must never originate here.
  if (verifiedUrl === null) return { ok: false, reason: 'UPLOAD_FAILED' };

  try {
    const inserted = await executor
      .insert(productReviewPhotos)
      .values({
        reviewId: input.reviewId,
        imageUrl: verifiedUrl,
        // Checksummed after re-encoding, matching `upload-seller-media.ts`: the
        // same photo submitted twice compares equal on what is stored, not on
        // bytes nobody keeps.
        checksum: createHash('sha256').update(processed.buffer).digest('hex'),
        byteSize: processed.buffer.byteLength,
        widthPixels: processed.width,
        heightPixels: processed.height,
        position,
      })
      .returning({ id: productReviewPhotos.id });

    const photoId = inserted[0]?.id;

    if (photoId === undefined) return { ok: false, reason: 'UPLOAD_FAILED' };

    return { ok: true, photoId, position };
  } catch (error) {
    // Another photo took this position between the count and the insert. Not a
    // failure to report as one: the review already holds a photo there, which
    // from the buyer's side is the same answer as being at the limit.
    if (isUniqueViolation(error)) return { ok: false, reason: 'LIMIT_REACHED' };

    throw error;
  }
}
