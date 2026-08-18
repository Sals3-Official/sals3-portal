'use server';

import { z } from 'zod';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { findProductForSteward } from '@/modules/catalog/products/repository';
import { uploadDescriptionImage } from '@/modules/catalog/products/description-image-storage';

/**
 * Upload boundary for an image placed inside a product description.
 *
 * Separate from `media-actions.ts` on purpose: that one writes a
 * `product_media_sources` row, which makes the photo a gallery image and a
 * cover-photo candidate. A description image is neither. This action stores
 * the file and hands back a URL; the description document itself is the only
 * place that URL is recorded, and it is saved with the draft.
 *
 * Consequence worth naming: an upload whose block is never saved leaves an
 * unreferenced object in R2. Accepted — the alternative is a staged-upload
 * lifecycle nothing else in this editor has.
 *
 * Same discipline as every other action here: authorize, rate-limit,
 * validate, then hand a server-resolved tenant to the domain module. Next.js
 * verifies the request origin for Server Actions, which is the CSRF control.
 */

const RATE_LIMIT = { capacity: 20, refillIntervalMs: 60_000 };

const inputSchema = z.object({ productId: z.string().uuid() });

export type UploadDescriptionImageActionResult =
  | { ok: true; url: string; widthPixels: number; heightPixels: number }
  | { ok: false; reason: string; message: string };

const REFUSAL_MESSAGES: Record<string, string> = {
  invalid_input: 'That could not be identified. Reload and try again.',
  denied: 'Your account cannot edit this product.',
  rate_limited: 'Too many uploads. Wait a moment and try again.',
  not_configured: 'The catalogue database is not available right now.',
  NOT_FOUND: 'This product no longer exists, or it is not yours.',
  EMPTY_FILE: 'That file is empty.',
  FILE_TOO_LARGE: 'That image is too large. The limit is 5 MB.',
  UNSUPPORTED_FILE_TYPE: 'Only JPEG, PNG, and WebP images can be uploaded.',
  DIMENSIONS_TOO_LARGE:
    'That image is too large. Resize it to at most 2000 × 2000 px and try again.',
  PROCESSING_FAILED: 'That file could not be read as an image.',
  STORAGE_NOT_CONFIGURED: 'Image storage is not configured yet.',
  UPLOAD_FAILED: 'The image could not be uploaded.',
};

function refuse(reason: string): UploadDescriptionImageActionResult {
  return {
    ok: false,
    reason,
    message: REFUSAL_MESSAGES[reason] ?? REFUSAL_MESSAGES.UPLOAD_FAILED ?? '',
  };
}

export default async function uploadDescriptionImageAction(
  formData: FormData,
): Promise<UploadDescriptionImageActionResult> {
  const parsed = inputSchema.safeParse({
    productId: formData.get('productId'),
  });

  if (!parsed.success) return refuse('invalid_input');

  const file = formData.get('file');

  // `FormData.get` on a browser's own upload always returns a `File` for an
  // `<input type="file">`-backed field; anything else means the request was
  // hand-crafted, not sent through the real editor.
  if (!(file instanceof File)) return refuse('invalid_input');

  if (!isDatabaseConfigured()) return refuse('not_configured');

  let session;

  try {
    session = await requirePermission('product:edit');
  } catch (error) {
    if (error instanceof PermissionError) return refuse('denied');
    throw error;
  }

  // ADR-006: this screen is the Dropshipper product editor, same scope as
  // every other write action on it.
  if (session.sellerBusinessModel !== 'DROPSHIPPER') return refuse('denied');

  if (
    !checkRateLimit(`description-image:${session.sellerId}`, RATE_LIMIT).allowed
  ) {
    return refuse('rate_limited');
  }

  // Ownership is checked before a byte is stored, so an authenticated seller
  // cannot use another seller's product id to park files in the bucket.
  const product = await findProductForSteward(
    getDb(),
    parsed.data.productId,
    session.sellerId,
  );

  if (product === null) return refuse('NOT_FOUND');

  const result = await uploadDescriptionImage({
    productId: product.id,
    fileBytes: await file.arrayBuffer(),
  });

  if (!result.ok) return refuse(result.reason);

  return {
    ok: true,
    url: result.url,
    widthPixels: result.widthPixels,
    heightPixels: result.heightPixels,
  };
}
