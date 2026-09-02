import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import revalidateListingViews from '@/app/(portal)/listings/revalidate-listing-views';
import appendSizeChart from '@/modules/catalog/products/append-size-chart';
import {
  authorizeEditorApiRequest,
  resolveApiActor,
} from '@/modules/catalog/products/editor-api-auth';

/**
 * POST /api/internal/products/[id]/description/append-chart - append a
 * transcribed size chart to the product's description.
 *
 * The rules live in `append-size-chart-plan.ts` (coverage against the
 * variant picker with XXL==2XL, append-only, never the lead block,
 * idempotent, one chart per page) and the walk in `append-size-chart.ts`,
 * which finishes in `saveDescriptionDocument` - the same domain function
 * the description route and the editor's Server Action call.
 *
 * The chart's numbers come from a person (or assistant) transcribing the
 * supplier's PICTURE by eye - the server checks the shape of the claim
 * against the picker, and can never check the numbers themselves. "CJ
 * publishes no measurements" stays a recorded result, never a licence to
 * invent a row.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({
    heading: z.string().trim().min(1).max(120).default('Size chart (cm)'),
    headers: z.array(z.string().trim().max(120)).min(1).max(12),
    rows: z
      .array(z.array(z.string().trim().max(120)).min(1).max(12))
      .min(1)
      .max(40),
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
    const result = await appendSizeChart({
      productId,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
      heading: body.heading,
      headers: body.headers,
      rows: body.rows,
    });

    if (!result.ok) {
      const statusOf: Record<string, number> = {
        not_found: 404,
        conflict: 409,
      };
      const status = statusOf[result.reason] ?? 422;

      return NextResponse.json(
        { ok: false, reason: result.reason, detail: result.detail },
        { status, headers: NO_STORE },
      );
    }

    if (result.outcome === 'appended') revalidateListingViews();

    return NextResponse.json(
      {
        ok: true,
        outcome: result.outcome,
        revisionId: result.revisionId,
        revisionVersion: result.revisionVersion,
        sizesOnSale: result.sizesOnSale,
        warnings: result.warnings,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal append-chart write failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
