import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import getDb, { type Database } from '@/lib/db/client';
import uniqueViolationConstraint from '@/lib/db/constraint-errors';
import { productMediaSources } from '@/lib/db/schema';
import { getR2Client, readR2Config } from '@/lib/storage/r2-client';
import { r2PublicImageUrl, r2PublicUrlForKey } from '@/lib/storage/r2-url';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import { PRODUCT_AUDIT_ACTIONS } from './contracts';
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
 * 2. Count - capped at `MAX_SELLER_IMAGES_PER_PRODUCT`, same reasoning as the
 *    supplier side's own cap: a page that renders 40 thumbnails is a page
 *    nobody scrolls.
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

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_SELLER_IMAGES_PER_PRODUCT = 12;
const MAX_DIMENSION_PX = 2000;
const OUTPUT_QUALITY = 82;
const OUTPUT_CONTENT_TYPE = 'image/webp';

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
  | { ok: false; reason: 'LIMIT_REACHED'; limit: number }
  | { ok: false; reason: 'FILE_TOO_LARGE'; maxBytes: number }
  | { ok: false; reason: 'EMPTY_FILE' }
  | { ok: false; reason: 'UNSUPPORTED_FILE_TYPE' }
  | { ok: false; reason: 'DIMENSIONS_TOO_LARGE'; maxDimensionPx: number }
  | { ok: false; reason: 'PROCESSING_FAILED' }
  | { ok: false; reason: 'STORAGE_NOT_CONFIGURED' }
  | { ok: false; reason: 'DUPLICATE_FILE' }
  | { ok: false; reason: 'UPLOAD_FAILED' };

/**
 * Reads the file's own magic number. Never trusts the browser-supplied
 * `File.type` header, which a request can set to anything regardless of the
 * actual bytes (rule 30/66 of the Next.js security gate). Purely a cheap
 * pre-filter - `sharp` is the real decoder and the real authority on whether
 * this is a usable image.
 */
function looksLikeAcceptedImage(bytes: Uint8Array): boolean {
  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;

  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;

  const isWebp =
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50; // P

  return isJpeg || isPng || isWebp;
}

type ImageDimensions = { width: number; height: number };

/**
 * A header-only read (no full pixel decode) so an oversized image can be
 * refused before the expensive resize/re-encode step runs. `.rotate()`
 * chained ahead of `.metadata()` accounts for EXIF orientation swapping
 * width/height - moot for a square limit, but keeps this correct if the two
 * axes ever diverge. `null` on anything unreadable, same as `processImage`.
 */
async function readImageDimensions(
  bytes: Uint8Array,
): Promise<ImageDimensions | null> {
  try {
    const metadata = await sharp(bytes).rotate().metadata();

    if (metadata.width === undefined || metadata.height === undefined) {
      return null;
    }

    return { width: metadata.width, height: metadata.height };
  } catch {
    return null;
  }
}

type ProcessedImage = { buffer: Buffer; width: number; height: number };

/**
 * Auto-orient, strip metadata, re-encode as WebP. The resize call is a no-op
 * safety net by the time this runs - the caller already refused anything
 * over `MAX_DIMENSION_PX` via `readImageDimensions` - kept as defense in
 * depth rather than the primary size control. `null` on anything `sharp`
 * cannot decode - a magic number is not proof the rest of the file is
 * well-formed.
 */
async function processImage(bytes: Uint8Array): Promise<ProcessedImage | null> {
  try {
    const { data, info } = await sharp(bytes)
      .rotate()
      .resize({
        width: MAX_DIMENSION_PX,
        height: MAX_DIMENSION_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: OUTPUT_QUALITY })
      .toBuffer({ resolveWithObject: true });

    return { buffer: data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

export async function uploadSellerProductMedia(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  fileBytes: ArrayBuffer;
  db?: Database;
}): Promise<UploadSellerMediaResult> {
  const r2Config = readR2Config();

  if (r2Config === null) {
    return { ok: false, reason: 'STORAGE_NOT_CONFIGURED' };
  }

  if (input.fileBytes.byteLength === 0) {
    return { ok: false, reason: 'EMPTY_FILE' };
  }

  if (input.fileBytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'FILE_TOO_LARGE', maxBytes: MAX_UPLOAD_BYTES };
  }

  const bytes = new Uint8Array(input.fileBytes);

  if (!looksLikeAcceptedImage(bytes)) {
    return { ok: false, reason: 'UNSUPPORTED_FILE_TYPE' };
  }

  const dimensions = await readImageDimensions(bytes);

  if (dimensions === null) {
    return { ok: false, reason: 'PROCESSING_FAILED' };
  }

  if (
    dimensions.width > MAX_DIMENSION_PX ||
    dimensions.height > MAX_DIMENSION_PX
  ) {
    return {
      ok: false,
      reason: 'DIMENSIONS_TOO_LARGE',
      maxDimensionPx: MAX_DIMENSION_PX,
    };
  }

  const processed = await processImage(bytes);

  if (processed === null) {
    return { ok: false, reason: 'PROCESSING_FAILED' };
  }

  const db = input.db ?? getDb();

  const product = await findProductForSteward(
    db,
    input.productId,
    input.sellerAccountId,
  );

  if (product === null) return { ok: false, reason: 'NOT_FOUND' };

  const existingCount = await db
    .select({ id: productMediaSources.id })
    .from(productMediaSources)
    .where(
      and(
        eq(productMediaSources.productId, product.id),
        eq(productMediaSources.sourceType, 'SELLER_UPLOAD'),
      ),
    );

  if (existingCount.length >= MAX_SELLER_IMAGES_PER_PRODUCT) {
    return {
      ok: false,
      reason: 'LIMIT_REACHED',
      limit: MAX_SELLER_IMAGES_PER_PRODUCT,
    };
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
        variantId: null,
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
