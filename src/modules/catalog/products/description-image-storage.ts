import 'server-only';

import { randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getR2Client, readR2Config } from '@/lib/storage/r2-client';
import { r2PublicImageUrl, r2PublicUrlForKey } from '@/lib/storage/r2-url';
import type { DescriptionDocument } from './description-document';
import {
  OUTPUT_CONTENT_TYPE,
  prepareUploadedImage,
  type ImagePipelineRefusal,
} from './image-upload-pipeline';

/**
 * Storage for images placed *inside* a product description.
 *
 * Deliberately not `product_media_sources`. That table is the gallery: every
 * row there is a cover-photo candidate, counts toward the publishable media
 * count, and appears in the buyer's gallery strip. A size chart or a
 * stitching close-up belongs to the description and to nothing else, so it
 * is stored in R2 and referenced by URL from the description document — the
 * document is the only record that it exists.
 *
 * The cost of that choice, stated rather than discovered later: an image
 * whose block is deleted leaves an orphaned R2 object. No reaper exists.
 * That is a storage-cost question, not a correctness one, and it is the same
 * trade the gallery already accepts for a duplicate upload.
 */

export type UploadDescriptionImageResult =
  | { ok: true; url: string; widthPixels: number; heightPixels: number }
  | ImagePipelineRefusal
  | { ok: false; reason: 'STORAGE_NOT_CONFIGURED' }
  | { ok: false; reason: 'UPLOAD_FAILED' };

export async function uploadDescriptionImage(input: {
  productId: string;
  fileBytes: ArrayBuffer;
}): Promise<UploadDescriptionImageResult> {
  const r2Config = readR2Config();

  if (r2Config === null) {
    return { ok: false, reason: 'STORAGE_NOT_CONFIGURED' };
  }

  const processed = await prepareUploadedImage(input.fileBytes);

  if (!processed.ok) return processed;

  // A random key, never the caller's own filename (rule 31: never trust a
  // user-supplied filename or path). The `description-media/` prefix keeps
  // these separable from `seller-media/` in the bucket, which is what makes
  // a later audit or cleanup pass possible at all.
  const objectKey = `description-media/${input.productId}/${randomUUID()}.webp`;

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

  if (verifiedUrl === null) return { ok: false, reason: 'UPLOAD_FAILED' };

  return {
    ok: true,
    url: verifiedUrl,
    widthPixels: processed.width,
    heightPixels: processed.height,
  };
}

/**
 * Every image address in a document must be one this deployment stored.
 *
 * The write-boundary half of the `image` block's URL rule. Without it a
 * crafted save request could point a description image at any host on the
 * internet — a tracking pixel, a hotlinked photo somebody else pays for, or
 * an address that later serves something entirely different. The document
 * schema deliberately does not carry this check, so that a configuration
 * change can never retroactively make stored documents unreadable; this runs
 * only on the way in.
 *
 * Returns `false` when R2 is unconfigured *and* the document contains an
 * image, because nothing can vouch for the address in that case.
 */
export function descriptionImagesAreStored(
  document: DescriptionDocument,
): boolean {
  return document.blocks.every(
    (block) =>
      block.type !== 'image' || r2PublicImageUrl.parse(block.url) !== null,
  );
}
