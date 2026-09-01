import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import uniqueViolationConstraint from '@/lib/db/constraint-errors';
import {
  authorizeEditorApiRequest,
  resolveApiActor,
} from '@/modules/catalog/products/editor-api-auth';
import { revalidateAfterPublicationChangeFromRouteHandler } from '@/modules/catalog/products/publish-side-effects';
import saveOptionMapping from '@/modules/catalog/products/save-option-mapping';

/**
 * POST /api/internal/products/[id]/option-mapping - the automation
 * equivalent of `option-mapping-actions.ts`'s `saveOptionMappingAction` (the
 * derived path: axis names and per-token display labels, checked against the
 * supplier labels' own re-derived split - see that file's "the client sends
 * names, never structure" note, which holds exactly as much here).
 *
 * `COMBINATION_CONSTRAINT` translated the same way the Server Action does:
 * a unique-violation here is a real, explainable outcome, not a bug.
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
          values: z
            .array(
              z.object({
                raw: z.string().min(1),
                label: z.string().trim().min(1).max(120),
              }),
            )
            .min(1),
        }),
      )
      .min(1),
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
    const raw: unknown = await request.json();
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
    let result;

    try {
      result = await saveOptionMapping({
        productId,
        sellerAccountId: actor.sellerAccountId,
        actorId: actor.actorId,
        expectedProductVersion:
          body.expectedProductVersion ?? actor.productVersion,
        axes: body.axes,
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

    // Same reasoning as `option-mapping-actions.ts`: the editor and the PDP
    // both read the Variant Matrix through the catalogue read-model, and a
    // live product can be mapped without a publish step in between. This
    // helper covers both the storefront tag and `revalidateListingViews()`.
    revalidateAfterPublicationChangeFromRouteHandler();

    return NextResponse.json(
      {
        ok: true,
        axisCount: result.axisCount,
        mappedVariantCount: result.mappedVariantCount,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal option-mapping write failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
