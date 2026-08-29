import { NextResponse, type NextRequest } from 'next/server';

/**
 * POST /api/internal/products/backfill-draft-pricing — prices the drafts that
 * were created before anything could price them.
 *
 * `create-draft.ts` calls the resolver with `UNMAPPED` and a null category,
 * hardcoded to decline — correct when written, because a fresh CJ product has
 * no Sals3 category. Nothing priced the offers afterwards, so a sourced product
 * sat at `PRICING_UNRESOLVED`, showed **Not available**, and blocked its own
 * publication. `decide-category` prices now, which fixes every product mapped
 * from here on and none of the ones mapped before it.
 *
 * Verified on the owner's account 2026-08-30: re-saving one product's existing
 * category — changing nothing — moved it from `Not available` to `$20.70`. This
 * is that, without the clicking.
 *
 * Same break-glass pattern as the pricing migrations: `CRON_SECRET`-gated,
 * dispatched by hand, reported in counts.
 *
 * ## Resuming
 *
 * Each call works until its budget and returns `done` plus the `position` it
 * reached. Call again with that position until `done`. Each product is written
 * on its own, so a call that dies loses nothing.
 *
 * ## What it will not touch
 *
 * Published offers, and drafts that already carry a price. A published price is
 * what a buyer is being charged; a draft that has one was priced by something,
 * possibly a person, and `product_offers` keeps no history — overwriting it
 * would be a permanent, invisible loss.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * Well inside `maxDuration`. The budget is checked between products and a
 * product that has started always finishes, so a call can overrun by one.
 */
const BUDGET_MS = 200_000;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  if (secret === undefined || secret.trim() === '') return false;

  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, reason: 'unauthorized' },
      { status: 401, headers: NO_STORE },
    );
  }

  // Imported lazily so an unconfigured or unreachable database cannot turn this
  // route into a build-time or cold-start failure.
  const [
    { default: getDb, isDatabaseConfigured },
    { default: backfillDraftPricing, BACKFILL_START },
    { default: priceDraftOffers },
  ] = await Promise.all([
    import('@/lib/db/client'),
    import('@/modules/catalog/products/backfill-draft-pricing'),
    import('@/modules/catalog/products/price-draft-offers'),
  ]);

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, reason: 'no-database-configured' },
      { status: 503, headers: NO_STORE },
    );
  }

  const afterProductId =
    request.nextUrl.searchParams.get('afterProductId') || null;

  try {
    const result = await backfillDraftPricing(getDb(), {
      position: afterProductId === null ? BACKFILL_START : { afterProductId },
      budgetMs: BUDGET_MS,
      actorId: 'system',
      price: priceDraftOffers,
    });

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] draft pricing backfill failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'backfill-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
