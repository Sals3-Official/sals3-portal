import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import revalidateListingViews from '@/app/(portal)/listings/revalidate-listing-views';
import {
  authorizeEditorApiRequest,
  resolveApiActor,
} from '@/modules/catalog/products/editor-api-auth';
import renameOptionMapping from '@/modules/catalog/products/rename-option-mapping';

/**
 * POST /api/internal/products/[id]/option-mapping/rename - the automation
 * equivalent of `option-mapping-actions.ts`'s `renameOptionMappingAction`.
 *
 * Unlike every other option-mapping route, this one takes database ids
 * (`optionId`/`valueId`) rather than raw supplier tokens - it only changes
 * the words a buyer reads and the order they read them in, never the axis
 * count or which supplier token backs which axis, so the option-combination
 * key is untouched. That is also why this is the one route in the family
 * that does not expire the storefront tag: the Server Action itself only
 * calls `revalidateListingViews()`, matching it exactly here.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({
    expectedProductVersion: z.number().int().positive().optional(),
    axes: z
      .array(
        z.object({
          optionId: z.string().uuid(),
          name: z.string().trim().min(1).max(60),
          values: z
            .array(
              z.object({
                valueId: z.string().uuid(),
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
    const result = await renameOptionMapping({
      productId,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
      expectedProductVersion:
        body.expectedProductVersion ?? actor.productVersion,
      axes: body.axes,
    });

    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : 409;
      return NextResponse.json(
        { ok: false, reason: result.reason, detail: result.detail },
        { status, headers: NO_STORE },
      );
    }

    revalidateListingViews();

    return NextResponse.json(
      {
        ok: true,
        axisCount: result.axisCount,
        renamedValueCount: result.renamedValueCount,
        reorderedAxisCount: result.reorderedAxisCount,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal option-mapping rename failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
