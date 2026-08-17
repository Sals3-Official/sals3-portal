'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { deleteSellerProductMedia } from '@/modules/catalog/products/delete-seller-media';
import { uploadSellerProductMedia } from '@/modules/catalog/products/upload-seller-media';

/**
 * The authorized entry points for a seller managing their own product
 * photos (ADR-011 "Your pictures"; storage backend, Vercel Blob, owner
 * decision 2026-08-17).
 *
 * Same discipline as `category-mapping-actions.ts`: authorize, rate-limit,
 * validate, then hand a server-resolved tenant and actor to the domain
 * module. Called directly with a `FormData`/plain object (not through a
 * `<form action>`) so the calling client component can await a per-item
 * result and update its own list - see `ProductEditorWorkspace.tsx`'s
 * `handleUploadMedia`/`handleDeleteMedia`.
 *
 * Next.js verifies the request origin for Server Actions, which is the CSRF
 * control for these cookie-backed mutations. `serverActions.bodySizeLimit`
 * in `next.config.ts` is the framework-level ceiling above the upload
 * module's own `MAX_UPLOAD_BYTES` check.
 */

const RATE_LIMIT = { capacity: 20, refillIntervalMs: 60_000 };

const uploadMediaInputSchema = z.object({
  productId: z.string().uuid(),
});

const deleteMediaInputSchema = z.object({
  productId: z.string().uuid(),
  mediaId: z.string().uuid(),
});

export type UploadMediaActionResult =
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
  | { ok: false; reason: string; message: string };

export type DeleteMediaActionResult =
  { ok: true } | { ok: false; reason: string; message: string };

const REFUSAL_MESSAGES: Record<string, string> = {
  invalid_input: 'That could not be identified. Reload and try again.',
  denied: 'Your account cannot manage photos for this product.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  not_configured: 'The catalogue database is not available right now.',
  NOT_FOUND: 'This product or photo no longer exists, or it is not yours.',
  EMPTY_FILE: 'That file is empty.',
  FILE_TOO_LARGE: 'That photo is too large. The limit is 5 MB per photo.',
  UNSUPPORTED_FILE_TYPE: 'Only JPEG, PNG, and WebP photos can be uploaded.',
  DIMENSIONS_TOO_LARGE:
    'That photo is too large. Resize it to at most 2000 × 2000 px and try again.',
  PROCESSING_FAILED: 'That file could not be read as an image.',
  STORAGE_NOT_CONFIGURED: 'Photo storage is not configured yet.',
  DUPLICATE_FILE: 'That exact photo has already been uploaded.',
  LIMIT_REACHED: 'This product already has the maximum number of photos.',
  UPLOAD_FAILED: 'The photo could not be uploaded.',
};

type Refusal = { ok: false; reason: string; message: string };

function refuse(reason: string): Refusal {
  return {
    ok: false,
    reason,
    message: REFUSAL_MESSAGES[reason] ?? REFUSAL_MESSAGES.UPLOAD_FAILED ?? '',
  };
}

type Authorized = { ok: true; sellerAccountId: string; actorId: string };
type AuthorizationFailure = {
  ok: false;
  reason: 'denied' | 'rate_limited' | 'not_configured';
};

/** `bucket` keeps upload and delete attempts from consuming each other's rate-limit budget. */
async function authorize(
  bucket: 'media-upload' | 'media-delete',
): Promise<Authorized | AuthorizationFailure> {
  if (!isDatabaseConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }

  let session;

  try {
    session = await requirePermission('product:edit');
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, reason: 'denied' };
    throw error;
  }

  // ADR-006: this screen is the Dropshipper product editor, same scope as
  // `category-mapping-actions.ts`/`option-mapping-actions.ts`.
  if (session.sellerBusinessModel !== 'DROPSHIPPER') {
    return { ok: false, reason: 'denied' };
  }

  const limit = checkRateLimit(`${bucket}:${session.sellerId}`, RATE_LIMIT);

  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  return {
    ok: true,
    sellerAccountId: session.sellerId,
    actorId: session.userId,
  };
}

export async function uploadSellerMediaAction(
  formData: FormData,
): Promise<UploadMediaActionResult> {
  const parsed = uploadMediaInputSchema.safeParse({
    productId: formData.get('productId'),
  });

  if (!parsed.success) return refuse('invalid_input');

  const file = formData.get('file');

  // `FormData.get` on a browser's own upload always returns a `File` for a
  // `<input type="file">`-backed field; anything else means the request was
  // hand-crafted, not sent through the real editor.
  if (!(file instanceof File)) return refuse('invalid_input');

  const authorization = await authorize('media-upload');

  if (!authorization.ok) return refuse(authorization.reason);

  const result = await uploadSellerProductMedia({
    productId: parsed.data.productId,
    sellerAccountId: authorization.sellerAccountId,
    actorId: authorization.actorId,
    fileBytes: await file.arrayBuffer(),
  });

  if (!result.ok) return refuse(result.reason);

  // Same reasoning as `decideCategoryMappingAction`: this product's Product
  // Catalogue row can show its media too. The editor itself updates from
  // this action's own return value - see `ProductEditorWorkspace.tsx`'s
  // `handleUploadMedia`, which appends the new tile to local state rather
  // than waiting on a cache-busted re-render.
  revalidatePath('/listings');

  return { ok: true, media: result.media };
}

export async function deleteSellerMediaAction(
  input: unknown,
): Promise<DeleteMediaActionResult> {
  const parsed = deleteMediaInputSchema.safeParse(input);

  if (!parsed.success) return refuse('invalid_input');

  const authorization = await authorize('media-delete');

  if (!authorization.ok) return refuse(authorization.reason);

  const result = await deleteSellerProductMedia({
    productId: parsed.data.productId,
    mediaId: parsed.data.mediaId,
    sellerAccountId: authorization.sellerAccountId,
    actorId: authorization.actorId,
  });

  if (!result.ok) return refuse(result.reason);

  revalidatePath('/listings');

  return { ok: true };
}
