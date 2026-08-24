'use server';

import { z } from 'zod';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import saveShowSupplierPhoto from '@/modules/catalog/products/save-show-supplier-photo';
import revalidateListingViews from './revalidate-listing-views';

/**
 * The protected boundary for a seller's own "show supplier photo" toggle.
 * Same discipline as `meta-description-actions.ts`: Zod-validate, authorize,
 * rate-limit, then hand a server-resolved tenant and actor to the domain
 * module. `sellerAccountId`/`actorId` come only from the session, never the
 * request.
 *
 * No storefront cache tag is touched: nothing renders this field yet.
 *
 * Next.js verifies the request origin for Server Actions, which is the CSRF
 * control for this cookie-backed mutation.
 */

const RATE_LIMIT = { capacity: 30, refillIntervalMs: 60_000 };

const saveShowSupplierPhotoInputSchema = z.object({
  productId: z.string().uuid(),
  /** The version the seller's screen read. Compare-and-set, not a hint. */
  expectedProductVersion: z.number().int().positive(),
  showSupplierPhoto: z.boolean(),
});

export type SaveShowSupplierPhotoActionResult =
  | { ok: true; productVersion: number }
  | { ok: false; reason: string; message: string };

const REFUSAL_MESSAGES: Record<string, string> = {
  invalid_input: 'That could not be read.',
  denied: 'Your account cannot edit this product.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  not_configured: 'The catalogue database is not available right now.',
  not_found: 'This product no longer exists, or it is not yours.',
  version_conflict:
    'This product changed in another tab or session. Reload the editor and try again.',
  failed: 'The setting could not be saved.',
};

function refuse(reason: string): SaveShowSupplierPhotoActionResult {
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
  // `meta-description-actions.ts`.
  if (session.sellerBusinessModel !== 'DROPSHIPPER') {
    return { ok: false, reason: 'denied' };
  }

  const limit = checkRateLimit(
    `show-supplier-photo:${session.sellerId}`,
    RATE_LIMIT,
  );

  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  return {
    ok: true,
    sellerAccountId: session.sellerId,
    actorId: session.userId,
  };
}

export default async function saveShowSupplierPhotoAction(
  input: unknown,
): Promise<SaveShowSupplierPhotoActionResult> {
  const parsed = saveShowSupplierPhotoInputSchema.safeParse(input);

  if (!parsed.success) return refuse('invalid_input');

  const authorization = await authorize();

  if (!authorization.ok) return refuse(authorization.reason);

  const result = await saveShowSupplierPhoto({
    productId: parsed.data.productId,
    sellerAccountId: authorization.sellerAccountId,
    actorId: authorization.actorId,
    expectedProductVersion: parsed.data.expectedProductVersion,
    showSupplierPhoto: parsed.data.showSupplierPhoto,
  });

  if (!result.ok) return refuse(result.reason);

  revalidateListingViews();

  return { ok: true, productVersion: result.productVersion };
}
