import { NextResponse, type NextRequest } from 'next/server';
import { diagnoseFreightQuote } from '@/modules/checkout/diagnose-freight-quote';

/**
 * GET /api/internal/checkout/diagnose-freight-quote — why one product 503s on
 * freight-quotes, without guessing.
 *
 * Same break-glass authentication as every other internal route: a manual
 * `workflow_dispatch`, `CRON_SECRET`-authenticated, no Vercel dashboard access
 * or raw production `DATABASE_URL` ever required on a laptop.
 *
 * Read-only. It resolves the product's supplier binding and repeats the same
 * two CJ reads `loadPackageInputs` makes, but returns their raw bodies instead
 * of collapsing a failure into the buyer-facing 503 — see the module's own
 * doc comment for why that collapse exists and why this tool is the
 * sanctioned way around it.
 *
 * `?productSlug=…&variantId=…&country=PH`. `variantId` and `country` are
 * optional; `country` defaults to `PH` since that is the destination the
 * report reproduced against.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  if (secret === undefined || secret.trim() === '') return false;

  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, reason: 'unauthorized' },
      { status: 401, headers: NO_STORE },
    );
  }

  const { searchParams } = request.nextUrl;
  const productSlug = searchParams.get('productSlug');

  if (productSlug === null || productSlug.trim() === '') {
    return NextResponse.json(
      { ok: false, reason: 'missing-product-slug' },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const result = await diagnoseFreightQuote({
      productSlug,
      variantId: searchParams.get('variantId') ?? undefined,
      destinationCountry: searchParams.get('country') ?? 'PH',
    });

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] freight-quote diagnosis failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'diagnosis-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
