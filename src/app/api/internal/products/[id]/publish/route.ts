import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import storefrontOrigin from '@/lib/storefront/origin';
import publishProduct from '@/modules/catalog/products/publish';
import {
  mirrorSupplierMediaAfterResponse,
  revalidateAfterPublicationChangeFromRouteHandler,
} from '@/modules/catalog/products/publish-side-effects';
import {
  authorizeEditorApiRequest,
  resolveApiActor,
} from '@/modules/catalog/products/editor-api-auth';

/**
 * POST /api/internal/products/[id]/publish - the automation equivalent of
 * `publish-actions.ts`'s `publishProductAction`, for a caller with no
 * seller session cookie.
 *
 * Calls the SAME domain function (`publishProduct`) and the SAME two
 * post-publish side effects (`revalidateAfterPublicationChange`,
 * `mirrorSupplierMediaAfterResponse`, both extracted to
 * `publish-side-effects.ts` so the Server Action and this route cannot
 * silently disagree about what "published" does). See
 * `editor-api-auth.ts` for why `sellerAccountId`/`actorId` are resolved
 * from the product rather than a session.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({
    /** Optional for the same reason `specifications` makes it optional -
     * see that route's doc comment. */
    expectedProductVersion: z.number().int().positive().optional(),
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
  })
  .strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const caller = await authorizeEditorApiRequest(request);

  if (caller === null) {
    return NextResponse.json(
      { ok: false, reason: 'unauthorized' },
      { status: 401, headers: NO_STORE },
    );
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, reason: 'not_configured' },
      { status: 503, headers: NO_STORE },
    );
  }

  const { id: productId } = await params;

  let body: z.infer<typeof bodySchema>;

  try {
    const raw: unknown = await request.json().catch(() => ({}));
    body = bodySchema.parse(raw);
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_input' },
      { status: 400, headers: NO_STORE },
    );
  }

  const actor = await resolveApiActor(caller, productId);

  if (actor === null) {
    return NextResponse.json(
      { ok: false, reason: 'not_found' },
      { status: 404, headers: NO_STORE },
    );
  }

  try {
    const outcome = await publishProduct({
      productId,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
      expectedProductVersion:
        body.expectedProductVersion ?? actor.productVersion,
      variantRetailPrices: body.variantRetailPrices ?? [],
    });

    if (!outcome.ok) {
      const status = outcome.reason === 'not_found' ? 404 : 409;
      return NextResponse.json(
        { ok: false, reason: outcome.reason, detail: outcome.detail },
        { status, headers: NO_STORE },
      );
    }

    revalidateAfterPublicationChangeFromRouteHandler();
    mirrorSupplierMediaAfterResponse(productId);

    return NextResponse.json(
      {
        ok: true,
        slug: outcome.slug,
        storefrontUrl: `${storefrontOrigin()}/p/${outcome.slug}`,
        offerCount: outcome.publishedOfferIds.length,
        availability: outcome.availability,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal publish failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
