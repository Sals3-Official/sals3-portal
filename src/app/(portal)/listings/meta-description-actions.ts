'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import saveMetaDescription from '@/modules/catalog/products/save-meta-description';

/**
 * The protected boundary for a seller's own Meta Description edit.
 *
 * Same discipline as `option-mapping-actions.ts` and
 * `category-mapping-actions.ts`: Zod-validate, authorize, rate-limit, then
 * hand a server-resolved tenant and actor to the domain module.
 * `sellerAccountId`/`actorId` come only from the session, never the request.
 *
 * A cap well above the recommended 140-160 character search-snippet range is
 * enforced here — the recommendation is UI guidance the seller can exceed on
 * purpose (`MetaDescriptionField`'s own counter/warning), not a hard
 * publish gate; the server cap exists only to bound storage and payload
 * size, not to enforce SEO style.
 *
 * No storefront cache tag is touched: nothing renders this field yet (a
 * later PDP/storefront task is what will), so there is no cache to expire.
 *
 * Next.js verifies the request origin for Server Actions, which is the CSRF
 * control for this cookie-backed mutation.
 */

const RATE_LIMIT = { capacity: 30, refillIntervalMs: 60_000 };
const MAX_META_DESCRIPTION_LENGTH = 320;

const saveMetaDescriptionInputSchema = z.object({
  productId: z.string().uuid(),
  /** The version the seller's screen read. Compare-and-set, not a hint. */
  expectedProductVersion: z.number().int().positive(),
  /** Empty string means "clear it" and is stored as `null`, not `''`. */
  metaDescription: z.string().trim().max(MAX_META_DESCRIPTION_LENGTH),
});

export type SaveMetaDescriptionActionResult =
  | { ok: true; productVersion: number }
  | { ok: false; reason: string; message: string };

const REFUSAL_MESSAGES: Record<string, string> = {
  invalid_input: `That could not be read. Keep the meta description under ${MAX_META_DESCRIPTION_LENGTH} characters.`,
  denied: 'Your account cannot edit this product.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  not_configured: 'The catalogue database is not available right now.',
  not_found: 'This product no longer exists, or it is not yours.',
  version_conflict:
    'This product changed in another tab or session. Reload the editor and try again.',
  failed: 'The meta description could not be saved.',
};

function refuse(reason: string): SaveMetaDescriptionActionResult {
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
  // `option-mapping-actions.ts`/`media-actions.ts`.
  if (session.sellerBusinessModel !== 'DROPSHIPPER') {
    return { ok: false, reason: 'denied' };
  }

  const limit = checkRateLimit(
    `meta-description:${session.sellerId}`,
    RATE_LIMIT,
  );

  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  return {
    ok: true,
    sellerAccountId: session.sellerId,
    actorId: session.userId,
  };
}

export default async function saveMetaDescriptionAction(
  input: unknown,
): Promise<SaveMetaDescriptionActionResult> {
  const parsed = saveMetaDescriptionInputSchema.safeParse(input);

  if (!parsed.success) return refuse('invalid_input');

  const authorization = await authorize();

  if (!authorization.ok) return refuse(authorization.reason);

  const result = await saveMetaDescription({
    productId: parsed.data.productId,
    sellerAccountId: authorization.sellerAccountId,
    actorId: authorization.actorId,
    expectedProductVersion: parsed.data.expectedProductVersion,
    metaDescription:
      parsed.data.metaDescription === '' ? null : parsed.data.metaDescription,
  });

  if (!result.ok) return refuse(result.reason);

  revalidatePath('/listings');

  return { ok: true, productVersion: result.productVersion };
}
