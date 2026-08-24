'use server';

import { z } from 'zod';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import saveCategoryAttributes from '@/modules/catalog/products/save-category-attributes';
import type { CategoryAttributeSubmissionValidation } from '@/modules/catalog/taxonomy/attribute-types';
import revalidateListingViews from './revalidate-listing-views';

/**
 * The protected boundary for saving a seller's answers to their product's
 * category-driven attribute controls (the Specification section).
 *
 * Same discipline as `option-mapping-actions.ts`: Zod-validate, authorize,
 * rate-limit, then hand a server-resolved tenant and actor to the domain
 * module. The input carries no `sellerAccountId` and no `actorId`; both are
 * derived from the session.
 *
 * SEO/AEO/GEO visibility metadata is not yet surfaced on the storefront, so
 * unlike `option-mapping-actions.ts` this does not call
 * `updateTag(STOREFRONT_CATALOG_TAG)` - revisit once/if a PDP/schema task
 * maps that metadata to visible content.
 *
 * Next.js verifies the request origin for Server Actions, which is the CSRF
 * control for these cookie-backed mutations.
 */

const RATE_LIMIT = { capacity: 30, refillIntervalMs: 60_000 };

const categoryAttributesInputSchema = z.object({
  productId: z.string().uuid(),
  /** The version the seller's screen read. Compare-and-set, not a hint. */
  expectedProductVersion: z.number().int().positive(),
  attributes: z.record(
    z.string().trim().min(1).max(120),
    z.array(z.string().max(2_000)).max(50),
  ),
});

export type CategoryAttributesActionResult =
  | {
      ok: true;
      productVersion: number;
      validation: CategoryAttributeSubmissionValidation;
    }
  | { ok: false; reason: string; message: string };

const REFUSAL_MESSAGES: Record<string, string> = {
  invalid_input: 'Those specifications could not be read.',
  denied: 'Your account cannot edit this product.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  not_configured: 'The catalogue database is not available right now.',
  not_found: 'This product no longer exists, or it is not yours.',
  version_conflict:
    'This product changed in another tab or session. Reload the editor and try again.',
  NO_CATEGORY_ASSIGNED:
    'This product has no Sals3 category assigned yet. Choose a category in Basic Information first.',
  ATTRIBUTE_CONTROLS_UNAVAILABLE:
    'No specification controls are available for this product’s category yet.',
  failed: 'The specifications could not be saved.',
};

function refuse(reason: string): CategoryAttributesActionResult {
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

  // ADR-006: a supplier-backed catalogue record is a Dropshipper capability.
  if (session.sellerBusinessModel !== 'DROPSHIPPER') {
    return { ok: false, reason: 'denied' };
  }

  const limit = checkRateLimit(
    `category-attributes:${session.sellerId}`,
    RATE_LIMIT,
  );

  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  return {
    ok: true,
    sellerAccountId: session.sellerId,
    actorId: session.userId,
  };
}

export default async function saveCategoryAttributesAction(
  input: unknown,
): Promise<CategoryAttributesActionResult> {
  const parsed = categoryAttributesInputSchema.safeParse(input);

  if (!parsed.success) return refuse('invalid_input');

  const authorization = await authorize();

  if (!authorization.ok) return refuse(authorization.reason);

  const result = await saveCategoryAttributes({
    productId: parsed.data.productId,
    sellerAccountId: authorization.sellerAccountId,
    actorId: authorization.actorId,
    expectedProductVersion: parsed.data.expectedProductVersion,
    attributes: parsed.data.attributes,
  });

  if (!result.ok) return refuse(result.reason);

  // The editor reads specifications through the catalogue read-model, so
  // listing views must re-read rather than serve the pre-save render.
  revalidateListingViews();

  return {
    ok: true,
    productVersion: result.productVersion,
    validation: result.validation,
  };
}
