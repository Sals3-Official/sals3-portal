'use server';

import { z } from 'zod';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import assignVariantMedia from '@/modules/catalog/products/assign-variant-media';
import revalidateListingViews from './revalidate-listing-views';

/**
 * The protected boundary for pointing a stored photo at one variant.
 *
 * Same discipline as `media-actions.ts` and `show-supplier-photo-actions.ts`:
 * Zod-validate, authorize, rate-limit, then hand a server-resolved tenant and
 * actor to the domain module. `sellerAccountId`/`actorId` come only from the
 * session, never the request — so a crafted payload carries no identity to
 * escalate with, and `assignVariantMedia` re-checks that the media row and the
 * variant row both belong to the named product.
 *
 * Unlike its neighbours this is not a compare-and-set on `products.version`.
 * The write touches one nullable column on one media row: it creates no
 * revision, invalidates no price, and cannot conflict with a concurrent draft
 * save. Demanding a version token would mean a seller who changed a photo in
 * one tab could not change a different photo in another, for no correctness
 * gain. Two sellers cannot race here at all — the row belongs to one tenant.
 *
 * Costs nothing at the supplier: the photo is already stored, and no CJ call is
 * made (ADR-017).
 *
 * Next.js verifies the request origin for Server Actions, which is the CSRF
 * control for this cookie-backed mutation.
 */

const RATE_LIMIT = { capacity: 60, refillIntervalMs: 60_000 };

const assignVariantMediaInputSchema = z.object({
  productId: z.string().uuid(),
  mediaId: z.string().uuid(),
  /** `null` returns the photo to product level. */
  variantId: z.string().uuid().nullable(),
});

export type AssignVariantMediaActionResult =
  | { ok: true; mediaId: string; variantId: string | null }
  | { ok: false; reason: string; message: string };

const REFUSAL_MESSAGES: Record<string, string> = {
  invalid_input: 'That photo could not be read.',
  denied: 'Your account cannot edit this product.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  not_configured: 'The catalogue database is not available right now.',
  not_found: 'This product no longer exists, or it is not yours.',
  // Both name the same seller-visible situation — the screen is describing a
  // photo or a variant that is no longer there — and neither says which id was
  // wrong, because that is the same information a crafted request would want.
  MEDIA_NOT_FOUND:
    'That photo is no longer stored on this product. Reload the editor and try again.',
  VARIANT_NOT_FOUND:
    'That variant is no longer part of this product. Reload the editor and try again.',
  failed: 'The photo could not be linked to that variant.',
};

function refuse(reason: string): AssignVariantMediaActionResult {
  return {
    ok: false,
    reason,
    message: REFUSAL_MESSAGES[reason] ?? REFUSAL_MESSAGES.failed ?? '',
  };
}

type Authorized = { ok: true; sellerAccountId: string; actorId: string };
type AuthorizationFailure = {
  ok: false;
  reason: 'denied' | 'rate_limited' | 'not_configured';
};

async function authorize(): Promise<Authorized | AuthorizationFailure> {
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
  // `media-actions.ts`.
  if (session.sellerBusinessModel !== 'DROPSHIPPER') {
    return { ok: false, reason: 'denied' };
  }

  const limit = checkRateLimit(`variant-media:${session.sellerId}`, RATE_LIMIT);

  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  return {
    ok: true,
    sellerAccountId: session.sellerId,
    actorId: session.userId,
  };
}

export default async function assignVariantMediaAction(
  input: unknown,
): Promise<AssignVariantMediaActionResult> {
  const parsed = assignVariantMediaInputSchema.safeParse(input);

  if (!parsed.success) return refuse('invalid_input');

  const authorization = await authorize();

  if (!authorization.ok) return refuse(authorization.reason);

  const result = await assignVariantMedia({
    productId: parsed.data.productId,
    mediaId: parsed.data.mediaId,
    variantId: parsed.data.variantId,
    sellerAccountId: authorization.sellerAccountId,
    actorId: authorization.actorId,
  });

  if (!result.ok) return refuse(result.reason);

  // The editor reads variant media through the catalogue read-model, so the
  // listing views must re-read. No storefront tag: a variant photo is not part
  // of the published feed until the listing is published again.
  revalidateListingViews();

  return { ok: true, mediaId: result.mediaId, variantId: result.variantId };
}
