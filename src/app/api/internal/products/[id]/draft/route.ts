import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import { sals3CategoryL1Schema } from '@/modules/catalog/products/contracts';
import { descriptionDocumentSchema } from '@/modules/catalog/products/description-document';
import {
  authorizeEditorApiRequest,
  resolveApiActor,
  resolveProductRevision,
} from '@/modules/catalog/products/editor-api-auth';
import saveProductDraft from '@/modules/catalog/products/save-draft';

/**
 * POST /api/internal/products/[id]/draft - the automation equivalent of
 * `product-draft-actions.ts`'s `saveProductDraftAction`: saves title,
 * Sals3 L1 category and structured description onto an open draft revision
 * in one write.
 *
 * `revisionId`/`expectedRevisionVersion` are optional and auto-resolved via
 * `resolveProductRevision`, same as `description/route.ts` and
 * `meta-description/route.ts` - the revision a caller who has not
 * separately read the editor would be looking at.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const MAX_TITLE_LENGTH = 200;

const bodySchema = z
  .object({
    revisionId: z.string().uuid().optional(),
    expectedRevisionVersion: z.number().int().positive().optional(),
    title: z.string().trim().min(3).max(MAX_TITLE_LENGTH),
    sals3CategoryL1: sals3CategoryL1Schema,
    descriptionDocument: descriptionDocumentSchema,
    variantRetailPrices: z.array(
      z.object({
        variantId: z.string().uuid(),
        amountMinor: z.number().int().positive(),
        currency: z
          .string()
          .trim()
          .regex(/^[A-Z]{3}$/),
      }),
    ),
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

  let { revisionId, expectedRevisionVersion } = body;

  if (revisionId === undefined || expectedRevisionVersion === undefined) {
    const revision = await resolveProductRevision(productId);
    if (revision === null) {
      return NextResponse.json(
        { ok: false, reason: 'not_found' },
        { status: 404, headers: NO_STORE },
      );
    }
    revisionId = revisionId ?? revision.revisionId;
    expectedRevisionVersion =
      expectedRevisionVersion ?? revision.revisionVersion;
  }

  try {
    const outcome = await saveProductDraft({
      request: {
        productId,
        revisionId,
        expectedRevisionVersion,
        title: body.title,
        sals3CategoryL1: body.sals3CategoryL1,
        descriptionDocument: body.descriptionDocument,
        variantRetailPrices: body.variantRetailPrices,
      },
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
    });

    if (!outcome.ok) {
      const status = outcome.reason === 'not_found' ? 404 : 409;
      return NextResponse.json(
        { ok: false, reason: outcome.reason },
        { status, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        revisionId: outcome.revisionId,
        revisionVersion: outcome.revisionVersion,
        forked: outcome.forked,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal save product draft failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
