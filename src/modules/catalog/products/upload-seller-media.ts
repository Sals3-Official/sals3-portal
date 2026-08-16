import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import { and, eq } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import uniqueViolationConstraint from '@/lib/db/constraint-errors';
import { productMediaSources } from '@/lib/db/schema';
import { vercelBlobImageUrl } from '@/lib/storage/blob-url';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import { PRODUCT_AUDIT_ACTIONS } from './contracts';
import { findProductForSteward } from './repository';

/**
 * Turns a seller's own file upload into a `product_media_sources` row
 * (ADR-011 §1 "Your pictures"), stored in Vercel Blob (owner decision
 * 2026-08-17).
 *
 * This is the seller-upload counterpart to `media-projection.ts`'s
 * `projectSupplierMediaForProduct`: same table, same rights-basis-required
 * invariant, opposite direction - that module copies a supplier's already-
 * public URL as evidence; this one receives bytes nobody has seen before and
 * is the only writer that may set `sourceType: 'SELLER_UPLOAD'`.
 *
 * ## Validation, in order
 *
 * 1. Ownership - `findProductForSteward` re-reads the product under this
 *    seller's own id, inside the same request. A well-formed `productId` the
 *    caller does not own resolves identically to an unknown one.
 * 2. Count - capped at `MAX_SELLER_IMAGES_PER_PRODUCT`, same reasoning as the
 *    supplier side's own cap: a page that renders 40 thumbnails is a page
 *    nobody scrolls.
 * 3. Size - rejected before any upload attempt.
 * 4. Actual bytes - `sniffImageContentType` reads the file's own magic
 *    number rather than trusting `file.type`, which is a client-supplied
 *    header a request can set to anything.
 *
 * ## What this deliberately does not do
 *
 * No `widthPixels`/`heightPixels` are recorded. Reading real dimensions
 * needs a decoder, and the one evaluated for it (`image-size`) carries an
 * unpatched high-severity denial-of-service advisory for other formats it
 * also parses - not an acceptable trade for a cosmetic dimension line. `0`
 * already means "not measured" on this column for supplier evidence too, so
 * this is a known state, not a new one.
 *
 * No resizing or compression: Vercel Blob stores the original bytes as-is.
 * `MAX_UPLOAD_BYTES` is the size control instead.
 */

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_SELLER_IMAGES_PER_PRODUCT = 12;

/** The only types `sniffImageContentType` recognises - the real allow list. */
type AllowedContentType = 'image/jpeg' | 'image/png' | 'image/webp';

const EXTENSION_BY_CONTENT_TYPE: Record<AllowedContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type UploadSellerMediaResult =
  | {
      ok: true;
      media: {
        id: string;
        sourceUrl: string;
        contentType: AllowedContentType;
        byteSize: number;
      };
    }
  | { ok: false; reason: 'NOT_FOUND' }
  | { ok: false; reason: 'LIMIT_REACHED'; limit: number }
  | { ok: false; reason: 'FILE_TOO_LARGE'; maxBytes: number }
  | { ok: false; reason: 'EMPTY_FILE' }
  | { ok: false; reason: 'UNSUPPORTED_FILE_TYPE' }
  | { ok: false; reason: 'STORAGE_NOT_CONFIGURED' }
  | { ok: false; reason: 'DUPLICATE_FILE' }
  | { ok: false; reason: 'UPLOAD_FAILED' };

/**
 * Reads the file's own magic number. Never trusts the browser-supplied
 * `File.type` header, which a request can set to anything regardless of the
 * actual bytes (rule 30/66 of the Next.js security gate).
 */
function sniffImageContentType(bytes: Uint8Array): AllowedContentType | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return 'image/webp';
  }

  return null;
}

export async function uploadSellerProductMedia(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  fileBytes: ArrayBuffer;
  db?: Database;
}): Promise<UploadSellerMediaResult> {
  if (process.env.BLOB_READ_WRITE_TOKEN === undefined) {
    return { ok: false, reason: 'STORAGE_NOT_CONFIGURED' };
  }

  if (input.fileBytes.byteLength === 0) {
    return { ok: false, reason: 'EMPTY_FILE' };
  }

  if (input.fileBytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'FILE_TOO_LARGE', maxBytes: MAX_UPLOAD_BYTES };
  }

  const bytes = new Uint8Array(input.fileBytes);
  const contentType = sniffImageContentType(bytes);

  if (contentType === null) {
    return { ok: false, reason: 'UNSUPPORTED_FILE_TYPE' };
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

  // A random path, never the caller's own filename (rule 31: never trust a
  // user-supplied filename or path). `addRandomSuffix` also protects against
  // two concurrent uploads racing the same generated name.
  const pathname = `seller-media/${product.id}/${randomUUID()}.${EXTENSION_BY_CONTENT_TYPE[contentType]}`;

  let blobUrl: string;

  try {
    const blob = await put(pathname, Buffer.from(bytes), {
      access: 'public',
      addRandomSuffix: true,
      contentType,
    });

    blobUrl = blob.url;
  } catch {
    return { ok: false, reason: 'UPLOAD_FAILED' };
  }

  const verifiedUrl = vercelBlobImageUrl.parse(blobUrl);

  // Unreachable while Vercel Blob's own SDK returns its own host, kept as a
  // hard refusal rather than a silent write: a row on this table with a
  // non-Blob `SELLER_UPLOAD` address is exactly the confusion the read
  // path's own host check (`read-model.ts`'s `allowedImageUrl`) exists to
  // catch, and it must never originate from this side of that boundary.
  if (verifiedUrl === null) return { ok: false, reason: 'UPLOAD_FAILED' };

  const checksum = createHash('sha256').update(bytes).digest('hex');
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
        contentType,
        byteSize: bytes.byteLength,
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
    // The exact byte content was already uploaded for this product - the
    // freshly-put blob above is now an orphan, an accepted cost of checking
    // uniqueness with a real index rather than a read-then-write race.
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
      contentType,
      byteSize: bytes.byteLength,
      checksum,
    },
  });

  return {
    ok: true,
    media: {
      id: inserted.id,
      sourceUrl: verifiedUrl,
      contentType,
      byteSize: bytes.byteLength,
    },
  };
}
