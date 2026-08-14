'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { STOREFRONT_CATALOG_TAG } from '@/lib/storefront/catalog-cache';
import publishProduct, {
  unpublishProduct,
  type PublishRefusal,
} from '@/modules/catalog/products/publish';

/**
 * The protected boundary for making a product visible to buyers.
 *
 * Same discipline as `product-draft-actions.ts`: Zod-validate, authorize,
 * rate-limit, then hand a server-resolved tenant and actor to the domain
 * module. The input carries no `sellerAccountId`, `actorId`, `marketCode`, or
 * `slug` — a crafted payload has nothing to escalate with, and each of those is
 * derived server-side from the session and the policy modules.
 *
 * **`variantRetailPrices` is the exception, and it is deliberate.** This comment
 * previously claimed the input carried no `price` or `currency` and that every
 * such value came from the pricing resolver. That stopped being true when seller
 * retail prices were accepted, and the claim was load-bearing: it read as "a
 * client cannot influence price", which it no longer did. A seller-supplied price
 * bypasses `resolveProductPricing` altogether. It is bounded by three things
 * instead — `positive()` here, the seller's own `product:publish` permission on
 * their own tenant, and the supplier-cost floor enforced in `publish.ts`, which
 * refuses `RETAIL_BELOW_SUPPLIER_COST` rather than publishing a loss.
 *
 * Publishing is tenant-owned authority (`product:publish` already exists in
 * `PORTAL_PERMISSIONS`), which is why this is a Server Action and not a script.
 * Category *governance* is the opposite — platform authority — and lives in
 * `scripts/approve-cj-category-mapping.mts` for that reason.
 *
 * Next.js verifies the request origin for Server Actions, which is the CSRF
 * control for these cookie-backed mutations.
 */

const RATE_LIMIT = { capacity: 30, refillIntervalMs: 60_000 };

const publishInputSchema = z.object({
  productId: z.string().uuid(),
  /** The version the operator's screen read. Compare-and-set, not a hint. */
  expectedProductVersion: z.number().int().positive(),
  variantRetailPrices: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        amountMinor: z.number().int().positive(),
        currency: z
          .string()
          .trim()
          .regex(/^[A-Z]{3}$/),
      }),
    )
    .optional(),
});

export type PublishActionFailureReason =
  | 'invalid_input'
  | 'denied'
  | 'rate_limited'
  | 'not_configured'
  | 'not_found'
  | 'version_conflict'
  | 'failed'
  | PublishRefusal;

export type PublishActionResult =
  | {
      ok: true;
      slug: string;
      offerCount: number;
      availability: 'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE';
    }
  | { ok: false; reason: PublishActionFailureReason; detail?: string };

export type UnpublishActionResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'invalid_input'
        | 'denied'
        | 'rate_limited'
        | 'not_configured'
        | 'not_found'
        | 'version_conflict'
        | 'failed';
    };

type Authorized = { ok: true; sellerAccountId: string; actorId: string };
type AuthorizationFailure = {
  ok: false;
  reason: 'denied' | 'rate_limited' | 'not_configured';
};

async function authorize(
  rateLimitKey: string,
): Promise<Authorized | AuthorizationFailure> {
  if (!isDatabaseConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }

  let session;

  try {
    session = await requirePermission('product:publish');
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
    `${rateLimitKey}:${session.sellerId}`,
    RATE_LIMIT,
  );

  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  return {
    ok: true,
    sellerAccountId: session.sellerId,
    actorId: session.userId,
  };
}

/**
 * Invalidating the storefront cache is what makes a publish visible now rather
 * than up to 30 seconds later.
 *
 * `updateTag`, not `revalidateTag`: Next's own docs reserve the former for
 * immediate expiration inside a Server Action, which is exactly this case — a
 * seller who pauses a mispriced product must not keep seeing it live. Called
 * outside the domain module's transaction on purpose: announcing a change that
 * could still roll back would publish a state that never committed.
 */
function revalidateAfterPublicationChange(): void {
  updateTag(STOREFRONT_CATALOG_TAG);
  revalidatePath('/listings');
}

export async function publishProductAction(
  input: unknown,
): Promise<PublishActionResult> {
  const parsed = publishInputSchema.safeParse(input);

  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize('catalog-product:publish');

  if (!auth.ok) return auth;

  try {
    const outcome = await publishProduct({
      productId: parsed.data.productId,
      sellerAccountId: auth.sellerAccountId,
      actorId: auth.actorId,
      expectedProductVersion: parsed.data.expectedProductVersion,
      variantRetailPrices: parsed.data.variantRetailPrices ?? [],
    });

    if (!outcome.ok) {
      return outcome.detail === undefined
        ? { ok: false, reason: outcome.reason }
        : { ok: false, reason: outcome.reason, detail: outcome.detail };
    }

    revalidateAfterPublicationChange();

    return {
      ok: true,
      slug: outcome.slug,
      offerCount: outcome.publishedOfferIds.length,
      availability: outcome.availability,
    };
  } catch (error) {
    // Generic outward failure; the detail stays in the server log. Never
    // return a constraint name, driver message, or stack to the client.
    // eslint-disable-next-line no-console
    console.error('[portal] publish product failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return { ok: false, reason: 'failed' };
  }
}

export async function unpublishProductAction(
  input: unknown,
): Promise<UnpublishActionResult> {
  const parsed = publishInputSchema.safeParse(input);

  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize('catalog-product:unpublish');

  if (!auth.ok) return auth;

  try {
    const outcome = await unpublishProduct({
      productId: parsed.data.productId,
      sellerAccountId: auth.sellerAccountId,
      actorId: auth.actorId,
      expectedProductVersion: parsed.data.expectedProductVersion,
    });

    if (!outcome.ok) return { ok: false, reason: outcome.reason };

    revalidateAfterPublicationChange();

    return { ok: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] unpublish product failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return { ok: false, reason: 'failed' };
  }
}
