'use server';

import { z } from 'zod';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { deleteSellerProductMedia } from '@/modules/catalog/products/delete-seller-media';
import reorderProductMedia from '@/modules/catalog/products/reorder-product-media';
import { uploadSellerProductMedia } from '@/modules/catalog/products/upload-seller-media';
import revalidateListingViews from './revalidate-listing-views';

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

/**
 * Twenty was the ceiling while a product could hold twelve photos in total, so
 * a full set plus a few retries always fitted inside one burst. Splitting the
 * gallery and variation budgets (`upload-seller-media.ts`) made a legitimate
 * first sitting much larger — twelve gallery photos plus one per variation, and
 * the reported 21-design product needs 21 of the latter — so a limiter that
 * refused at twenty would have made the new allowance a promise the upload path
 * could not keep, one photo per minute after the twentieth.
 *
 * Sixty covers the largest real product with headroom for retries, and matches
 * `MAX_VARIANT_PHOTOS_PER_PRODUCT`. The per-request cost it guards is unchanged
 * — the 5 MB / 2000 px input ceiling and the single `sharp` re-encode behind it
 * are exactly what they were (owner decision 2026-08-17) — so this permits more
 * of the same work in a burst, not more work per request. Refill stays one
 * token per minute: a sustained uploader is still throttled, only the opening
 * batch got room.
 */
const RATE_LIMIT = { capacity: 60, refillIntervalMs: 60_000 };

/** See `authorize` — a reorder is many cheap writes, not one expensive one. */
const REORDER_RATE_LIMIT = { capacity: 240, refillIntervalMs: 10_000 };

const uploadMediaInputSchema = z.object({
  productId: z.string().uuid(),
  /**
   * Absent for a gallery photo. `FormData.get` returns `null` for a field the
   * client never set, so `nullish` covers both shapes rather than making the
   * caller send an empty string.
   */
  variantId: z.string().uuid().nullish(),
});

const deleteMediaInputSchema = z.object({
  productId: z.string().uuid(),
  mediaId: z.string().uuid(),
});

/**
 * The whole gallery, in the seller's chosen order.
 *
 * Bounded at 64 so a crafted request cannot ask the server to walk an arbitrary
 * list: the real ceiling is 12 seller uploads plus the supplier's projected set,
 * which `media-projection.ts` caps at 12 as well, so 64 is generous headroom
 * rather than a limit any real product meets. `reorderProductMedia` still refuses
 * anything that is not exactly this product's gallery, so this is the cheap
 * shape check, not the authorization.
 */
const reorderMediaInputSchema = z.object({
  productId: z.string().uuid(),
  mediaIds: z.array(z.string().uuid()).min(1).max(64),
});

export type UploadMediaActionResult =
  | {
      ok: true;
      media: {
        id: string;
        /** `null` for a gallery photo; the variation it depicts otherwise. */
        variantId: string | null;
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

export type ReorderMediaActionResult =
  { ok: true } | { ok: false; reason: string; message: string };

const REFUSAL_MESSAGES: Record<string, string> = {
  invalid_input: 'That could not be identified. Reload and try again.',
  denied: 'Your account cannot manage photos for this product.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  not_configured: 'The catalogue database is not available right now.',
  NOT_FOUND: 'This product or photo no longer exists, or it is not yours.',
  VARIANT_NOT_FOUND:
    'That variation no longer exists, or it belongs to another product.',
  VARIANT_PHOTO_EXISTS:
    'That variation already has a photo. Delete it first, then upload the replacement.',
  VARIANT_LIMIT_REACHED:
    'This product has as many variation photos as it can hold.',
  EMPTY_FILE: 'That file is empty.',
  FILE_TOO_LARGE: 'That photo is too large. The limit is 5 MB per photo.',
  UNSUPPORTED_FILE_TYPE: 'Only JPEG, PNG, and WebP photos can be uploaded.',
  DIMENSIONS_TOO_LARGE:
    'That photo is too large. Resize it to at most 2000 × 2000 px and try again.',
  PROCESSING_FAILED: 'That file could not be read as an image.',
  STORAGE_NOT_CONFIGURED: 'Photo storage is not configured yet.',
  DUPLICATE_FILE: 'That exact photo has already been uploaded.',
  // Names the number and says where the other budget is. The old wording -
  // "This product already has the maximum number of photos." - named neither,
  // so a seller reading it could not tell whether uploading a variation photo
  // would help or hit the same wall.
  INCOMPLETE_ORDER:
    'The photo list changed while you were arranging it. Reload and try again.',
  DUPLICATE_MEDIA_ID: 'That could not be identified. Reload and try again.',
  LIMIT_REACHED:
    'Product media is full at 12 photos. Delete one, or add this as a variation photo instead.',
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
  bucket: 'media-upload' | 'media-delete' | 'media-reorder',
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

  // A drag commits one write per tile it crosses, so arranging spends its
  // budget far faster than uploading does and gets a wider one. It is also the
  // cheapest of the three writes by a wide margin: `UPDATE ... SET position`
  // over a couple of dozen rows, no decode, no object storage, no network call.
  const limit = checkRateLimit(
    `${bucket}:${session.sellerId}`,
    bucket === 'media-reorder' ? REORDER_RATE_LIMIT : RATE_LIMIT,
  );

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
    variantId: formData.get('variantId'),
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
    variantId: parsed.data.variantId ?? null,
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
  revalidateListingViews();

  return {
    ok: true,
    media: { ...result.media, variantId: parsed.data.variantId ?? null },
  };
}

/**
 * Commits the seller's gallery arrangement, which is also how the cover is
 * chosen (ADR-011 amendment 2026-08-28: the cover is position 0).
 *
 * Same discipline as the two actions around it — authorize, rate-limit,
 * validate, then hand a server-resolved tenant and actor to the domain module.
 * It writes `position` and nothing else, and it cannot delete a row, so the
 * amendment widens what a seller may *arrange* without widening what they may
 * destroy: `deleteSellerMediaAction` below still reaches `SELLER_UPLOAD` rows
 * only.
 */
export async function reorderProductMediaAction(
  input: unknown,
): Promise<ReorderMediaActionResult> {
  const parsed = reorderMediaInputSchema.safeParse(input);

  if (!parsed.success) return refuse('invalid_input');

  const authorization = await authorize('media-reorder');

  if (!authorization.ok) return refuse(authorization.reason);

  const result = await reorderProductMedia({
    productId: parsed.data.productId,
    mediaIds: parsed.data.mediaIds,
    sellerAccountId: authorization.sellerAccountId,
    actorId: authorization.actorId,
  });

  if (!result.ok) return refuse(result.reason);

  revalidateListingViews();

  return { ok: true };
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

  revalidateListingViews();

  return { ok: true };
}
