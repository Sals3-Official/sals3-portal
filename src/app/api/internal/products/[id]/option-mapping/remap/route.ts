import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import uniqueViolationConstraint from '@/lib/db/constraint-errors';
import { MANUAL_MAPPING_MAX_VARIANTS } from '@/lib/seller-center/product-editor/manual-mapping-assist';
import {
  isProductEditorApiAuthorized,
  resolveProductActor,
} from '@/modules/catalog/products/editor-api-auth';
import { revalidateAfterPublicationChangeFromRouteHandler } from '@/modules/catalog/products/publish-side-effects';
import remapOptionMapping from '@/modules/catalog/products/remap-option-mapping';

/**
 * POST /api/internal/products/[id]/option-mapping/remap - the automation
 * equivalent of `option-mapping-actions.ts`'s `remapOptionMappingAction`:
 * replacing a saved Variant Matrix in one step. Takes the same trust level
 * as the manual save (not the unmap route's), because a replacement always
 * leaves the page with a named matrix - a wrong replacement is still wrong,
 * but never a degradation to raw supplier tokens.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const COMBINATION_CONSTRAINT = 'product_variants_active_combination_key';

const bodySchema = z
  .object({
    expectedProductVersion: z.number().int().positive().optional(),
    axes: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(60),
          values: z.array(z.string().trim().min(1).max(120)).min(1),
        }),
      )
      .min(1)
      .max(4),
    assignments: z
      .array(
        z.object({
          variantId: z.string().uuid(),
          values: z.array(z.string().trim().min(1).max(120)).min(1).max(4),
        }),
      )
      .min(1)
      .max(MANUAL_MAPPING_MAX_VARIANTS),
    reason: z.string().trim().max(500).optional(),
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
    let result;

    try {
      result = await remapOptionMapping({
        productId,
        sellerAccountId: actor.sellerAccountId,
        actorId: actor.actorId,
        expectedProductVersion:
          body.expectedProductVersion ?? actor.productVersion,
        axes: body.axes,
        assignments: body.assignments,
        reason: body.reason ?? null,
      });
    } catch (error) {
      if (uniqueViolationConstraint(error) === COMBINATION_CONSTRAINT) {
        return NextResponse.json(
          { ok: false, reason: 'duplicate_combination' },
          { status: 409, headers: NO_STORE },
        );
      }

      throw error;
    }

    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : 409;
      return NextResponse.json(
        { ok: false, reason: result.reason, detail: result.detail },
        { status, headers: NO_STORE },
      );
    }

    revalidateAfterPublicationChangeFromRouteHandler();

    return NextResponse.json(
      {
        ok: true,
        axisCount: result.axisCount,
        mappedVariantCount: result.mappedVariantCount,
        replacedAxisCount: result.replacedAxisCount,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal option-mapping remap failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
