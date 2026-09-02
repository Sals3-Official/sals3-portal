import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import revalidateListingViews from '@/app/(portal)/listings/revalidate-listing-views';
import { descriptionDocumentSchema } from '@/modules/catalog/products/description-document';
import {
  authorizeEditorApiRequest,
  resolveApiActor,
  resolveProductRevision,
} from '@/modules/catalog/products/editor-api-auth';
import guardDescriptionCopy from '@/modules/catalog/products/guard-description-copy';
import saveDescriptionDocument from '@/modules/catalog/products/save-description-document';

/**
 * POST /api/internal/products/[id]/description - the automation equivalent
 * of `description-actions.ts`'s `saveDescriptionAction`.
 *
 * Uses the SAME `descriptionDocumentSchema` the Server Action validates
 * against (the allow-listed block shapes, the markup refusal, the emphasis
 * join invariant all live there - not reimplemented here) and calls the
 * SAME domain function. `revisionId`/`expectedRevisionVersion` are optional
 * - see `resolveProductRevision`'s doc comment for the resolution order
 * used when the caller has not separately read the editor first.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({
    revisionId: z.string().uuid().optional(),
    expectedRevisionVersion: z.number().int().positive().optional(),
    descriptionDocument: descriptionDocumentSchema,
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

  // The copy rules, before anything is stored. `descriptionDocumentSchema`
  // above checked the document's SHAPE; this checks what the words do (lead
  // paragraph, supplier citations, logistics, size claims vs the picker) -
  // rules that ran in the automation client until 2026-09-02 and now cannot
  // be skipped by skipping the client. Warnings ride along on success;
  // problems refuse with the whole list, because a writer fixing copy wants
  // all of it at once.
  const verdict = await guardDescriptionCopy(
    productId,
    body.descriptionDocument.blocks,
  );

  if (verdict.problems.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'copy_refused',
        detail: verdict.problems,
        warnings: verdict.warnings,
      },
      { status: 422, headers: NO_STORE },
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
    revisionId ??= revision.revisionId;
    expectedRevisionVersion ??= revision.revisionVersion;
  }

  try {
    const result = await saveDescriptionDocument({
      productId,
      revisionId,
      expectedRevisionVersion,
      descriptionDocument: body.descriptionDocument,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
    });

    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : 409;
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status, headers: NO_STORE },
      );
    }

    revalidateListingViews();

    return NextResponse.json(
      {
        ok: true,
        revisionId: result.revisionId,
        revisionVersion: result.revisionVersion,
        contentChecksum: result.contentChecksum,
        forked: result.forked,
        warnings: verdict.warnings,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal description write failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
