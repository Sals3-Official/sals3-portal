import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import uniqueViolationConstraint from '@/lib/db/constraint-errors';
import { productMediaSources, productVariants } from '@/lib/db/schema';
import { getR2Client, readR2Config } from '@/lib/storage/r2-client';
import { r2PublicImageUrl, r2PublicUrlForKey } from '@/lib/storage/r2-url';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import { PRODUCT_AUDIT_ACTIONS } from './contracts';
import {
  OUTPUT_CONTENT_TYPE,
  prepareUploadedImage,
} from './image-upload-pipeline';
import { findProductForSteward } from './repository';

/**
 * Turns a seller's own file upload into a `product_media_sources` row
 * (ADR-011 §1 "Your pictures"), stored in Cloudflare R2 (owner decision
 * 2026-08-17, superseding the earlier Vercel Blob backend — durable object
 * storage was the explicit requirement).
 *
 * This is the seller-upload counterpart to `media-projection.ts`'s
 * `projectSupplierMediaForProduct`: same table, same rights-basis-required
 * invariant, opposite direction - that module copies a supplier's already-
 * public URL as evidence; this one receives bytes nobody has seen before and
 * is the only writer that may set `sourceType: 'SELLER_UPLOAD'`.
 *
 * ## Validation and processing, in order
 *
 * 1. Ownership - `findProductForSteward` re-reads the product under this
 *    seller's own id, inside the same request. A well-formed `productId` the
 *    caller does not own resolves identically to an unknown one.
 * 2. Count - capped against one of two separate budgets, chosen by whether
 *    this upload is a gallery photo or a variation photo. See "Two budgets"
 *    below; the short version is that a page nobody scrolls and a variation
 *    nobody can tell apart are different problems and no longer share a
 *    number.
 * 3. Size - rejected before any decode is attempted.
 * 4. Actual bytes - `sniffImageContentType` reads the file's own magic
 *    number rather than trusting `file.type`, which is a client-supplied
 *    header a request can set to anything. This is a cheap pre-filter before
 *    the more expensive step below, not the format decision itself.
 * 5. Resolution - a cheap `sharp` metadata read (no full decode) refuses
 *    anything wider or taller than `MAX_DIMENSION_PX` outright (owner
 *    decision 2026-08-17: "wag mo payagan pumasok pag above 2000x2000").
 *    The seller resizes and re-uploads; this module does not silently
 *    downscale an oversized original on their behalf.
 * 6. Re-encode (owner decision 2026-08-17, "keep it high quality despite the
 *    size reduction") - `sharp` auto-orients from EXIF and re-encodes as
 *    WebP at `OUTPUT_QUALITY`. The resize call is a no-op safety net at this
 *    point (step 5 already guarantees the input fits), kept only as
 *    defense-in-depth. A corrupt file that still passed the magic-number
 *    check fails here instead of being stored.
 *
 * ## Why these specific numbers
 *
 * 2000px is comfortably above what any current storefront surface renders
 * (`cj-image-loader.ts` requests a handful of small widths for supplier
 * photos) while still standing up to a future zoom feature - and it is a
 * hard ceiling on the accepted upload, not just a resize target, since an
 * uncontrolled phone photo is routinely 3000-6000px on its long side and a
 * silent downscale would hide that from the seller. WebP quality 82 is
 * the conventional "no visible loss on a real photo, meaningfully smaller
 * file" setting; a 5MB JPEG input typically lands under 300KB at these
 * settings - the resize/re-encode step is what actually controls output
 * quality, not how large the accepted input was allowed to be. Lowered from
 * an initial 10MB (owner decision 2026-08-17): every real phone photo has
 * comfortably enough resolution under 5MB too, so the wider ceiling only
 * ever bought a larger in-memory decode (`sharp` holds the *decoded* bitmap
 * during processing, routinely 10-20x the compressed file size) and more
 * upload bandwidth per request, never better output.
 *
 * No `.withMetadata()` call means EXIF (including GPS, if present) is
 * dropped from the stored copy by default - `.rotate()` still bakes the
 * orientation in as pixels first, so the photo does not flip on delivery.
 */

/**
 * ## Two budgets, split by `variant_id` (2026-08-28)
 *
 * Until this change one constant of `12` bounded every `SELLER_UPLOAD` row on a
 * product, and it was answering two unrelated questions at once:
 *
 * - **how many photos a buyer scrolls** in the gallery — the reviewed argument,
 *   quoted from `media-projection.ts`: "a product page that renders 40
 *   thumbnails is a page nobody scrolls and a row count nobody reviews";
 * - **how many variations can be told apart** — one photo per option, which a
 *   buyer never scrolls, because they are shown exactly one, chosen by the
 *   option they picked.
 *
 * Sharing one budget meant the second starved the first. The reported case: a
 * beanie selling 21 flag designs consumed all 12 slots with variation photos,
 * left nine designs indistinguishable, and — because the storefront gallery had
 * no `variant_id` filter — turned the gallery itself into twelve near-identical
 * close-ups. Both halves of that were the shared budget.
 *
 * They are separate here because `variant_id` already separates them in the
 * table: `assignVariantMedia` *moves* a row between product level and a variant
 * rather than copying it, so a photo has exactly one home and the two counts
 * can never double-count the same row. No column was added and no migration is
 * needed.
 *
 * The gallery number is deliberately unchanged. It is the reviewed one, the
 * storefront's own `MAX_DETAIL_IMAGES` agrees with it, and this change removes
 * the pressure that made it look too small rather than arguing with it.
 */
const MAX_GALLERY_PHOTOS_PER_PRODUCT = 12;

/**
 * One photo per variation, because one is all a buyer is ever served.
 *
 * `read-model.ts`'s `variantImageUrl` is a correlated subquery with `limit 1`:
 * a second photo on the same variant is bytes stored, paid for, and shown to
 * nobody. Refusing it is more honest than accepting an upload whose only effect
 * is an R2 bill, and a seller replacing a variation photo deletes the old one
 * first — which is a visible, reversible act rather than a silent overwrite of
 * the file an order line may have frozen.
 *
 * A *group* still needs only one: `shareFirstAxisPhotos` spreads a first-axis
 * value's photo across every variant carrying that value, so a `Colour x Size`
 * product needs one photo per colour, not one per row.
 */
const MAX_PHOTOS_PER_VARIANT = 1;

/**
 * A backstop on total variation photos per product, not a UX limit.
 *
 * The real bound is one per variant and variants come from the supplier's own
 * list, so this never binds on a real catalogue product — the largest first
 * axis in the live catalogue is 21. It exists because "one per variant" is
 * unbounded in principle, and an unbounded storage path with no ceiling is the
 * kind of thing that is only ever discovered from a bill. Raise it if a real
 * product needs more; do not remove it.
 */
const MAX_VARIANT_PHOTOS_PER_PRODUCT = 60;

export type UploadSellerMediaResult =
  | {
      ok: true;
      media: {
        id: string;
        sourceUrl: string;
        contentType: string;
        byteSize: number;
        widthPixels: number;
        heightPixels: number;
      };
    }
  | { ok: false; reason: 'NOT_FOUND' }
  | { ok: false; reason: 'VARIANT_NOT_FOUND' }
  | { ok: false; reason: 'LIMIT_REACHED'; limit: number }
  | { ok: false; reason: 'VARIANT_PHOTO_EXISTS' }
  | { ok: false; reason: 'VARIANT_LIMIT_REACHED'; limit: number }
  | { ok: false; reason: 'FILE_TOO_LARGE'; maxBytes: number }
  | { ok: false; reason: 'EMPTY_FILE' }
  | { ok: false; reason: 'UNSUPPORTED_FILE_TYPE' }
  | { ok: false; reason: 'DIMENSIONS_TOO_LARGE'; maxDimensionPx: number }
  | { ok: false; reason: 'PROCESSING_FAILED' }
  | { ok: false; reason: 'STORAGE_NOT_CONFIGURED' }
  | { ok: false; reason: 'DUPLICATE_FILE' }
  | { ok: false; reason: 'UPLOAD_FAILED' };

export async function uploadSellerProductMedia(input: {
  productId: string;
  /**
   * The variation this photo depicts, or `null`/omitted for a gallery photo.
   *
   * Set at insert time rather than assigned afterwards, so a variation photo
   * never occupies a gallery slot even momentarily and the seller never has to
   * make a second decision to keep the two budgets straight. `assignVariantMedia`
   * remains the way to move an *existing* photo between the two.
   */
  variantId?: string | null;
  sellerAccountId: string;
  actorId: string;
  fileBytes: ArrayBuffer;
  db?: Database;
}): Promise<UploadSellerMediaResult> {
  const r2Config = readR2Config();

  if (r2Config === null) {
    return { ok: false, reason: 'STORAGE_NOT_CONFIGURED' };
  }

  const processed = await prepareUploadedImage(input.fileBytes);

  if (!processed.ok) return processed;

  const db = input.db ?? getDb();

  const product = await findProductForSteward(
    db,
    input.productId,
    input.sellerAccountId,
  );

  if (product === null) return { ok: false, reason: 'NOT_FOUND' };

  const variantId = input.variantId ?? null;

  if (variantId === null) {
    // Gallery budget: product-level seller uploads only. A variation photo is
    // not competing for these slots any more, which is the whole point of the
    // split.
    const galleryRows = await db
      .select({ id: productMediaSources.id })
      .from(productMediaSources)
      .where(
        and(
          eq(productMediaSources.productId, product.id),
          isNull(productMediaSources.variantId),
          eq(productMediaSources.sourceType, 'SELLER_UPLOAD'),
        ),
      );

    if (galleryRows.length >= MAX_GALLERY_PHOTOS_PER_PRODUCT) {
      return {
        ok: false,
        reason: 'LIMIT_REACHED',
        limit: MAX_GALLERY_PHOTOS_PER_PRODUCT,
      };
    }
  } else {
    // Matched on this product's own id, not merely on the variant's - the same
    // check and the same reason as `assignVariantMedia`: a variant belonging to
    // a *different* product of the *same* seller would pass a tenant check and
    // put this photo on goods it does not depict.
    const variantRows = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(
        and(
          eq(productVariants.id, variantId),
          eq(productVariants.productId, product.id),
        ),
      );

    if (variantRows.length === 0) {
      return { ok: false, reason: 'VARIANT_NOT_FOUND' };
    }

    const onThisVariant = await db
      .select({ id: productMediaSources.id })
      .from(productMediaSources)
      .where(
        and(
          eq(productMediaSources.productId, product.id),
          eq(productMediaSources.variantId, variantId),
          eq(productMediaSources.sourceType, 'SELLER_UPLOAD'),
        ),
      );

    if (onThisVariant.length >= MAX_PHOTOS_PER_VARIANT) {
      return { ok: false, reason: 'VARIANT_PHOTO_EXISTS' };
    }

    const variantPhotoRows = await db
      .select({ id: productMediaSources.id })
      .from(productMediaSources)
      .where(
        and(
          eq(productMediaSources.productId, product.id),
          isNotNull(productMediaSources.variantId),
          eq(productMediaSources.sourceType, 'SELLER_UPLOAD'),
        ),
      );

    if (variantPhotoRows.length >= MAX_VARIANT_PHOTOS_PER_PRODUCT) {
      return {
        ok: false,
        reason: 'VARIANT_LIMIT_REACHED',
        limit: MAX_VARIANT_PHOTOS_PER_PRODUCT,
      };
    }
  }

  // Object storage (Cloudflare R2), never the Postgres database - only the
  // resulting public URL, plus small metadata (checksum, dimensions, byte
  // size), is what the `insert` below writes to `product_media_sources`. A
  // random key, never the caller's own filename (rule 31: never trust a
  // user-supplied filename or path) - `randomUUID()` alone is enough to
  // avoid two concurrent uploads racing the same key, unlike Vercel Blob's
  // `addRandomSuffix` this replaces, R2's `PutObjectCommand` has no such
  // option because it needs none here.
  const objectKey = `seller-media/${product.id}/${randomUUID()}.webp`;

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

  // Unreachable while the URL is built from the same `publicBaseUrl` the
  // check itself reads, kept as a hard refusal rather than a silent write:
  // a row on this table with a non-R2 `SELLER_UPLOAD` address is exactly
  // the confusion the read path's own host check (`read-model.ts`'s
  // `allowedImageUrl`) exists to catch, and it must never originate from
  // this side of that boundary.
  if (verifiedUrl === null) return { ok: false, reason: 'UPLOAD_FAILED' };

  // Checksummed after re-encoding: the same source photo re-uploaded twice
  // must dedupe on what is actually stored, not on bytes nobody keeps.
  const checksum = createHash('sha256').update(processed.buffer).digest('hex');
  const observedAt = new Date();

  let inserted: { id: string } | undefined;

  try {
    [inserted] = await db
      .insert(productMediaSources)
      .values({
        productId: product.id,
        variantId,
        sourceType: 'SELLER_UPLOAD',
        sourceUrl: verifiedUrl,
        checksum,
        contentType: OUTPUT_CONTENT_TYPE,
        byteSize: processed.buffer.byteLength,
        widthPixels: processed.width,
        heightPixels: processed.height,
        // Uploading it is the seller's own declaration that they may use it -
        // the same reasoning `SUPPLIER_MEDIA_RIGHTS` documents for the
        // supplier side, mirrored here for the seller's own asset.
        rightsBasis: 'SELLER_DECLARED',
        reviewState: 'APPROVED',
        observedAt,
        createdBy: input.actorId,
      })
      .returning({ id: productMediaSources.id });
  } catch (error) {
    // The exact re-encoded bytes were already uploaded for this product -
    // the freshly-put R2 object above is now an orphan, an accepted cost of
    // checking uniqueness with a real index rather than a read-then-write
    // race.
    if (
      uniqueViolationConstraint(error) ===
      'product_media_sources_product_checksum_key'
    ) {
      return { ok: false, reason: 'DUPLICATE_FILE' };
    }

    throw error;
  }

  if (inserted === undefined) return { ok: false, reason: 'UPLOAD_FAILED' };

  await appendAuditEvent(db, {
    actorId: input.actorId,
    action: PRODUCT_AUDIT_ACTIONS.mediaUploaded,
    entityType: 'ProductMediaSource',
    entityId: inserted.id,
    payload: {
      productId: product.id,
      variantId,
      sellerAccountId: input.sellerAccountId,
      contentType: OUTPUT_CONTENT_TYPE,
      byteSize: processed.buffer.byteLength,
      widthPixels: processed.width,
      heightPixels: processed.height,
      checksum,
    },
  });

  return {
    ok: true,
    media: {
      id: inserted.id,
      sourceUrl: verifiedUrl,
      contentType: OUTPUT_CONTENT_TYPE,
      byteSize: processed.buffer.byteLength,
      widthPixels: processed.width,
      heightPixels: processed.height,
    },
  };
}
