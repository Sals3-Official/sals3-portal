'use server';

import { z } from 'zod';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { descriptionDocumentSchema } from '@/modules/catalog/products/description-document';
import saveDescriptionDocument from '@/modules/catalog/products/save-description-document';
import revalidateListingViews from './revalidate-listing-views';

/**
 * The protected boundary for a seller's own description edit.
 *
 * Same discipline as `meta-description-actions.ts` and
 * `option-mapping-actions.ts`: Zod-validate, authorize, rate-limit, then hand a
 * server-resolved tenant and actor to the domain module.
 * `sellerAccountId`/`actorId` come only from the session, never the request.
 *
 * The document is validated by `descriptionDocumentSchema` itself rather than a
 * looser action-local shape. That schema is the one place the allow list, the
 * markup refusal, and the emphasis join invariant live, so an editor that
 * learns to build a block it would refuse fails here rather than storing
 * something a renderer has to cope with.
 *
 * Next.js verifies the request origin for Server Actions, which is the CSRF
 * control for this cookie-backed mutation.
 */

/**
 * Lower than the meta-description limit: a description save carries a whole
 * document, so a runaway client costs more per attempt. Still far above a
 * human editing pace — the studio saves on an explicit press, not per
 * keystroke.
 */
const RATE_LIMIT = { capacity: 20, refillIntervalMs: 60_000 };

const saveDescriptionInputSchema = z.object({
  productId: z.string().uuid(),
  revisionId: z.string().uuid(),
  /** The revision version the seller's screen read. Compare-and-set, not a hint. */
  expectedRevisionVersion: z.number().int().positive(),
  descriptionDocument: descriptionDocumentSchema,
});

export type SaveDescriptionActionResult =
  | { ok: true; revisionVersion: number; contentChecksum: string }
  | { ok: false; reason: string; message: string };

const REFUSAL_MESSAGES: Record<string, string> = {
  invalid_input:
    'That description could not be read. Remove any pasted formatting and try again.',
  denied: 'Your account cannot edit this product.',
  rate_limited: 'Too many saves. Wait a moment and try again.',
  not_configured: 'The catalogue database is not available right now.',
  not_found: 'This product no longer exists, or it is not yours.',
  version_conflict:
    'This description changed in another tab or session. Reload the editor and try again.',
  image_not_stored:
    'One image is not stored in Sals3. Upload it again and save.',
  failed: 'The description could not be saved.',
};

function refuse(reason: string): SaveDescriptionActionResult {
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
  // `meta-description-actions.ts`/`media-actions.ts`.
  if (session.sellerBusinessModel !== 'DROPSHIPPER') {
    return { ok: false, reason: 'denied' };
  }

  const limit = checkRateLimit(`description:${session.sellerId}`, RATE_LIMIT);

  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  return {
    ok: true,
    sellerAccountId: session.sellerId,
    actorId: session.userId,
  };
}

export default async function saveDescriptionAction(
  input: unknown,
): Promise<SaveDescriptionActionResult> {
  const parsed = saveDescriptionInputSchema.safeParse(input);

  if (!parsed.success) return refuse('invalid_input');

  const authorization = await authorize();

  if (!authorization.ok) return refuse(authorization.reason);

  const result = await saveDescriptionDocument({
    productId: parsed.data.productId,
    revisionId: parsed.data.revisionId,
    expectedRevisionVersion: parsed.data.expectedRevisionVersion,
    descriptionDocument: parsed.data.descriptionDocument,
    sellerAccountId: authorization.sellerAccountId,
    actorId: authorization.actorId,
  });

  if (!result.ok) return refuse(result.reason);

  // Both surfaces read this document: the catalogue row's content-readiness
  // signal and the product editor the seller returns to.
  revalidateListingViews();

  return {
    ok: true,
    revisionVersion: result.revisionVersion,
    contentChecksum: result.contentChecksum,
  };
}
