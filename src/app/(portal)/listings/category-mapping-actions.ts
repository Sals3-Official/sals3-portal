'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { STOREFRONT_CATALOG_TAG } from '@/lib/storefront/catalog-cache';
import { authorizeCategoryGovernance } from '@/modules/catalog/taxonomy/authorization';
import { decideProductSals3Category } from '@/modules/catalog/products/decide-category';

/**
 * The one authorized entry point for a seller declaring their own product's
 * Sals3 category — every other route, page, or action must reach
 * `taxonomy/repository.ts`'s category-write functions only through this file
 * (`boundaries.test.ts` proves it, transitively through `decide-category.ts`).
 *
 * Same discipline as `option-mapping-actions.ts`: Zod-validate, authorize,
 * rate-limit, then hand a server-resolved tenant and actor to the domain
 * module. `authorizeCategoryGovernance()` is the governance-specific check
 * (owner decision 2026-08-15 — see `authorization.ts`), on top of the
 * ordinary `product:edit` gate that proves this session may touch product
 * data at all.
 *
 * Owner decision 2026-08-15 (revised same day): this is per-seller,
 * per-product — a seller's pick only ever changes the one product they had
 * open, never another seller's catalogue. `decide-category.ts` resolves
 * `sals3CategoryCode` against the real Sals3 Taxonomy v1 table and writes
 * directly to that one product; there is no shared CJ-category mapping this
 * action reads or writes, so no `externalCategoryId` is derived or accepted.
 * `sellerAccountId`/`actorId` still come only from the server-resolved
 * session, never the request.
 *
 * Next.js verifies the request origin for Server Actions, which is the CSRF
 * control for these cookie-backed mutations.
 */

const RATE_LIMIT = { capacity: 30, refillIntervalMs: 60_000 };

const decideCategoryInputSchema = z.object({
  productId: z.string().uuid(),
  /** The version the seller's screen read. Compare-and-set, not a hint. */
  expectedProductVersion: z.number().int().positive(),
  sals3CategoryCode: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(8).max(500),
});

export type DecideCategoryActionResult =
  | { ok: true; categoryCode: string; categoryPath: string }
  | { ok: false; reason: string; message: string };

const REFUSAL_MESSAGES: Record<string, string> = {
  invalid_input:
    'That could not be read. Pick a category and give at least a short reason.',
  denied: 'Your account cannot decide a category mapping.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  not_configured: 'The catalogue database is not available right now.',
  NOT_FOUND: 'This product no longer exists, or it is not yours.',
  UNKNOWN_SALS3_CATEGORY:
    'That is not a Sals3 Taxonomy v1 category. Search again and pick one from the list.',
  STALE_WRITE:
    'This product changed in another tab or session. Reload the editor and try again.',
  failed: 'The category mapping could not be recorded.',
};

function refuse(reason: string): DecideCategoryActionResult {
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

  // The governance-specific boundary, distinct from the ordinary
  // `product:edit` gate above: proves this session specifically holds
  // category-mapping authority, not just "may edit some product".
  if (!authorizeCategoryGovernance(session.role).allowed) {
    return { ok: false, reason: 'denied' };
  }

  // ADR-006: this screen is the Dropshipper product editor, same scope as
  // `option-mapping-actions.ts`.
  if (session.sellerBusinessModel !== 'DROPSHIPPER') {
    return { ok: false, reason: 'denied' };
  }

  const limit = checkRateLimit(
    `category-mapping:${session.sellerId}`,
    RATE_LIMIT,
  );

  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  return {
    ok: true,
    sellerAccountId: session.sellerId,
    actorId: session.userId,
  };
}

export async function decideCategoryMappingAction(
  input: unknown,
): Promise<DecideCategoryActionResult> {
  const parsed = decideCategoryInputSchema.safeParse(input);

  if (!parsed.success) return refuse('invalid_input');

  const authorization = await authorize();

  if (!authorization.ok) return refuse(authorization.reason);

  const result = await decideProductSals3Category({
    productId: parsed.data.productId,
    sellerAccountId: authorization.sellerAccountId,
    expectedProductVersion: parsed.data.expectedProductVersion,
    sals3CategoryCode: parsed.data.sals3CategoryCode,
    reason: parsed.data.reason,
    actorId: authorization.actorId,
  });

  if (!result.ok) return refuse(result.reason);

  // The editor reads the resolved category through the catalogue read-model,
  // and a published PDP through the storefront cache — same two-cache
  // reasoning as `saveOptionMappingAction`, since this can also change an
  // already-live product's category.
  revalidatePath('/listings');
  updateTag(STOREFRONT_CATALOG_TAG);

  return {
    ok: true,
    categoryCode: result.categoryCode,
    categoryPath: result.categoryPath,
  };
}
