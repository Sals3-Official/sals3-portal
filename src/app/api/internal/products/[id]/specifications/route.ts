import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import revalidateListingViews from '@/app/(portal)/listings/revalidate-listing-views';
import {
  isProductEditorApiAuthorized,
  resolveProductActor,
} from '@/modules/catalog/products/editor-api-auth';
import saveCategoryAttributes from '@/modules/catalog/products/save-category-attributes';

/**
 * POST /api/internal/products/[id]/specifications - the automation
 * equivalent of `category-attributes-actions.ts`'s
 * `saveCategoryAttributesAction`, for a caller with no seller session
 * cookie.
 *
 * Deliberately calls the SAME domain function
 * (`saveCategoryAttributes`) the Server Action calls, not a reimplementation
 * - see `editor-api-auth.ts`'s doc comment for why `sellerAccountId`/
 * `actorId` are resolved from the product itself rather than a session, and
 * `save-category-attributes.ts`'s own doc comment for the compare-and-set
 * and re-validation this inherits unchanged. `revalidateListingViews()` is
 * called for the same reason the Server Action calls it - see that file's
 * doc comment for the bug this exists to prevent (nine action files missed
 * it once already).
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({
    /**
     * Optimistic-concurrency guard, same field the Server Action's client
     * carries from the last page it read. Optional here: when omitted, the
     * version this route itself just resolved from the product is used -
     * safe for this route's actual caller (one automation actor, no
     * concurrent human edit expected), and still a real compare-and-set
     * against whatever `saveCategoryAttributes` reads inside its own
     * transaction, not a bypass of it.
     */
    expectedProductVersion: z.number().int().positive().optional(),
    attributes: z.record(
      z.string().trim().min(1).max(120),
      z.array(z.string().max(2_000)).max(50),
    ),
  })
  .strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isProductEditorApiAuthorized(request.headers.get('authorization'))) {
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
    const raw: unknown = await request.json();
    body = bodySchema.parse(raw);
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_input' },
      { status: 400, headers: NO_STORE },
    );
  }

  const actor = await resolveProductActor(productId);

  if (actor === null) {
    return NextResponse.json(
      { ok: false, reason: 'not_found' },
      { status: 404, headers: NO_STORE },
    );
  }

  try {
    const result = await saveCategoryAttributes({
      productId,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
      expectedProductVersion:
        body.expectedProductVersion ?? actor.productVersion,
      attributes: body.attributes,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status: 409, headers: NO_STORE },
      );
    }

    revalidateListingViews();

    return NextResponse.json(
      {
        ok: true,
        productVersion: result.productVersion,
        validation: result.validation,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal specifications write failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
