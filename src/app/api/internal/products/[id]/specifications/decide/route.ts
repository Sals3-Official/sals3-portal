import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import revalidateListingViews from '@/app/(portal)/listings/revalidate-listing-views';
import {
  authorizeEditorApiRequest,
  resolveApiActor,
} from '@/modules/catalog/products/editor-api-auth';
import suggestProductAttributes from '@/modules/catalog/products/suggest-attributes';

/**
 * POST /api/internal/products/[id]/specifications/decide - decide the
 * product's category attributes server-side, and optionally write them.
 *
 * The rules (`suggest-attributes-rules.ts`) used to run in the automation
 * client; the owner's 2026-09-02 instruction moved them here. The caller
 * still supplies the two facts only it can know - CJ's property table
 * (`cjProperties`, read off CJ's website by a browser) and photograph
 * answers (`known`) - and gets back what was decided, an audit note per
 * decision, and the fields still needing a person, by name and with their
 * allowed values.
 *
 * `apply: false` (the default) writes nothing - a dry run to read before
 * committing. `apply: true` hands the decisions to `saveCategoryAttributes`,
 * the same domain function the editor's Server Action calls - partial-save
 * semantics, compare-and-set, server re-validation all inherited unchanged.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({
    cjProperties: z
      .array(
        z.object({
          label: z.string().trim().max(200),
          value: z.string().trim().max(2_000),
        }),
      )
      .max(200)
      .default([]),
    known: z
      .record(z.string().trim().min(1).max(120), z.string().trim().max(200))
      .default({}),
    apply: z.boolean().default(false),
    expectedProductVersion: z.number().int().positive().optional(),
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
    const result = await suggestProductAttributes({
      productId,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
      supplierProperties: body.cjProperties,
      known: body.known,
      apply: body.apply,
      expectedProductVersion:
        body.expectedProductVersion ?? actor.productVersion,
    });

    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : 409;
      return NextResponse.json(
        { ok: false, reason: result.reason, suggestion: result.suggestion },
        { status, headers: NO_STORE },
      );
    }

    if (result.applied) revalidateListingViews();

    return NextResponse.json(
      {
        ok: true,
        decided: result.suggestion.decided,
        notes: result.suggestion.notes,
        pending: result.suggestion.pending,
        applied: result.applied,
        productVersion: result.productVersion,
        validation: result.validation,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal specifications decide failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
