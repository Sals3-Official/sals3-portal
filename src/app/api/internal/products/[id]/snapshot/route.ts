import { NextResponse, type NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import {
  authorizeEditorApiRequest,
  resolveApiActor,
} from '@/modules/catalog/products/editor-api-auth';
import { readProductSnapshot } from '@/modules/catalog/products/editor-api-reads';

/**
 * GET /api/internal/products/[id]/snapshot - everything the Product Editor
 * renders for this product, so a caller never has to scrape the page to
 * find out what it may write.
 *
 * This is the route whose absence made the rest of this API awkward. A
 * specification write needs the category's own `allowedValues`; a
 * variant-photo write needs a `mediaId` and a `variantId`; an option mapping
 * needs the supplier labels. All of it was in the database and none of it
 * was reachable, so the automation opened a browser to look - and every
 * reader it built against a rendered page eventually broke on a Portal
 * change that was nobody's fault. See `editor-api-reads.ts` for the three
 * that did.
 *
 * `GET`, not `POST`: it writes nothing. It is still auth-gated and still
 * `no-store` - the payload is one seller's whole product record.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(
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

  // Same resolution a write uses, and for the same reason: a session caller
  // reads as ITSELF, so another tenant's product id is simply not found
  // rather than served.
  const actor = await resolveApiActor(caller, productId);

  if (actor === null) {
    return NextResponse.json(
      { ok: false, reason: 'not_found' },
      { status: 404, headers: NO_STORE },
    );
  }

  try {
    const snapshot = await readProductSnapshot({
      sellerAccountId: actor.sellerAccountId,
      productId,
    });

    if (snapshot === null) {
      return NextResponse.json(
        { ok: false, reason: 'not_found' },
        { status: 404, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        productId,
        productVersion: actor.productVersion,
        snapshot,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal product snapshot read failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'read_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
