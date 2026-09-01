import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import {
  authorizeEditorApiRequest,
  readTenantForListing,
} from '@/modules/catalog/products/editor-api-auth';
import { readReadyCandidates } from '@/modules/catalog/products/editor-api-reads';

/**
 * GET /api/internal/candidates/ready - screened candidates, each carrying
 * whether it is already in the catalogue.
 *
 * ## The money guard, served instead of inferred
 *
 * Drafting a candidate that already has a product spends 10 CJ points again -
 * `captureEvidenceBeforeDraft` runs before the idempotency check. So the
 * question "is this one already drafted" is a spending decision, and until
 * now a client answered it by reading a rendered page. Two ways that went
 * wrong on 2026-09-02 alone:
 *
 * - The row's only UUID is CJ's own thumbnail filename
 *   (`cf.cjdropshipping.com/quick/product/<uuid>.jpg`), which is
 *   indistinguishable from a candidate id. Three confident ids were read and
 *   the API answered `not_found` on all three. It cost nothing only because
 *   ownership is checked before CJ is called.
 * - Reading the id from the detail drawer's `?candidate=` URL works once,
 *   then Escape clears the URL without removing the sheet and the next click
 *   lands on an overlay - so 21 available candidates read as 1.
 *
 * `alreadyInCatalogue` here is the same `findCataloguedCandidateIds` the
 * Ready table itself renders its disabled buttons from. Owner's instruction
 * 2026-09-02: a candidate whose status is "In Catalogue" is not to be taken
 * again. Served as a field, it cannot be missed.
 *
 * **`excludeDrafted=true` is the default.** A caller asking for candidates
 * to draft should have to opt IN to seeing ones it must not pay for again,
 * not remember to filter them out.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().trim().min(1).max(120).optional(),
  excludeDrafted: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
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

  const params = request.nextUrl.searchParams;

  let query: z.infer<typeof querySchema>;

  try {
    query = querySchema.parse({
      ...(params.get('limit') === null ? {} : { limit: params.get('limit') }),
      ...(params.get('offset') === null
        ? {}
        : { offset: params.get('offset') }),
      ...(params.get('search') === null
        ? {}
        : { search: params.get('search') }),
      ...(params.get('excludeDrafted') === null
        ? {}
        : { excludeDrafted: params.get('excludeDrafted') }),
    });
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_input' },
      { status: 400, headers: NO_STORE },
    );
  }

  const tenant = await readTenantForListing(
    caller,
    params.get('sellerAccountId'),
  );

  if (!tenant.ok) {
    return NextResponse.json(
      { ok: false, reason: tenant.reason },
      { status: tenant.reason === 'not_found' ? 404 : 400, headers: NO_STORE },
    );
  }

  try {
    const rows = await readReadyCandidates({
      sellerAccountId: tenant.sellerAccountId,
      limit: query.limit,
      offset: query.offset,
      search: query.search,
    });

    const draftable = rows.filter((row) => !row.alreadyInCatalogue);

    return NextResponse.json(
      {
        ok: true,
        // Both counts, always. "5 of 100 are draftable" is a fact a caller
        // planning a points spend needs, and it is invisible if the response
        // only carries the filtered list.
        screened: rows.length,
        alreadyInCatalogue: rows.length - draftable.length,
        candidates: query.excludeDrafted ? draftable : rows,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal ready-candidates read failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'read_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
