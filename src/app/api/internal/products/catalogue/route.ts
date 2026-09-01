import { NextResponse, type NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import {
  authorizeEditorApiRequest,
  readTenantForListing,
} from '@/modules/catalog/products/editor-api-auth';
import { readCatalogue } from '@/modules/catalog/products/editor-api-reads';

/**
 * GET /api/internal/products/catalogue - the seller's whole catalogue, in
 * one response, unpaginated.
 *
 * Unpaginated is the point. `/listings` paginates at 25 rows because a
 * person reads 25 rows at a time (Portal PR #290), and a client that needs
 * to know "have I already drafted this" needs all of them - so a scraper
 * comparing page one's rows against the header's total could never agree
 * again, and the sourcing money-guard built on that comparison refused every
 * run from then on. Serving the list directly removes the comparison rather
 * than fixing it.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

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

  const tenant = await readTenantForListing(
    caller,
    request.nextUrl.searchParams.get('sellerAccountId'),
  );

  if (!tenant.ok) {
    return NextResponse.json(
      { ok: false, reason: tenant.reason },
      { status: tenant.reason === 'not_found' ? 404 : 400, headers: NO_STORE },
    );
  }

  try {
    const products = await readCatalogue({
      sellerAccountId: tenant.sellerAccountId,
    });

    return NextResponse.json(
      { ok: true, count: products.length, products },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal catalogue read failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'read_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
