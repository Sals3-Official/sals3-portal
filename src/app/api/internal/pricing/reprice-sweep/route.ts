import { NextResponse, type NextRequest } from 'next/server';

/**
 * POST /api/internal/pricing/reprice-sweep — brings every live price in line
 * with today's rules, one page at a time, resumably.
 *
 * ## Why this is not a button
 *
 * `RepriceControls` refuses to run unscoped, and that stays true: owner
 * decision 2026-08-29, on a catalogue heading for millions of listings. One
 * query, one preview table and one click must never stand between a seller and
 * every price they own. The screen still covers one department in one
 * destination, reviewed before it is applied.
 *
 * What the screen cannot be is a way to *finish*. Aligning a catalogue after a
 * rules change is every department across every destination, each several pages
 * deep — hundreds of reviewed clicks for a job with no judgement in it. So it
 * lives here, with the rest of the bulk production work: `CRON_SECRET`-gated,
 * dispatched by hand from GitHub's own UI, reported in counts.
 *
 * ## Read it before you run it
 *
 * `GET` plans and writes nothing. It reports how many prices the first page of
 * every scope would move — a **lower bound**, because a dry run cannot advance
 * within a scope without writing, so it never sees page two. Treat it as "at
 * least this many are out of line", not as a total.
 *
 * ## Resuming
 *
 * Each call works until its budget and returns `done` plus the `position` it
 * reached. Call again with that position until `done` is true. A call that dies
 * loses nothing: the position it would have returned is the last page that
 * actually committed.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * Well inside `maxDuration`, because the budget is checked **between** pages
 * and a page that has started always finishes. The gap is the headroom for one
 * page of up to `MAX_REPRICE_OFFERS` offers.
 */
const BUDGET_MS = 200_000;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  if (secret === undefined || secret.trim() === '') return false;

  return request.headers.get('authorization') === `Bearer ${secret}`;
}

function readPosition(request: NextRequest) {
  const scopeIndex = Number(
    request.nextUrl.searchParams.get('scopeIndex') ?? 0,
  );
  const afterSku = request.nextUrl.searchParams.get('afterSku');

  return {
    scopeIndex:
      Number.isInteger(scopeIndex) && scopeIndex >= 0 ? scopeIndex : 0,
    afterSku: afterSku === null || afterSku === '' ? null : afterSku,
  };
}

async function sweep(request: NextRequest, apply: boolean) {
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
    { listSweepScopes, runRepriceSweep },
    { applyRepricePlan },
    { appendAuditEvent },
  ] = await Promise.all([
    import('@/lib/db/client'),
    import('@/modules/pricing/reprice-sweep'),
    import('@/modules/pricing/reprice'),
    import('@/modules/catalog/candidates/repository'),
  ]);

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, reason: 'no-database-configured' },
      { status: 503, headers: NO_STORE },
    );
  }

  /*
    Off unless the URL says otherwise, and it has to be asked for by name.

    Reclaiming replaces prices a person decided, and `product_offers` keeps no
    history — the old number survives only in the audit payload. A seller who
    approves that in the dialog has read the department it applies to. Nobody
    reads a sweep, so it cannot be the default here.
  */
  const reclaimSellerPriced =
    request.nextUrl.searchParams.get('reclaim') === 'true';

  try {
    const db = getDb();
    const scopes = await listSweepScopes(db);

    const result = await runRepriceSweep(db, scopes, {
      apply,
      reclaimSellerPriced,
      position: readPosition(request),
      budgetMs: BUDGET_MS,
      write: (sellerAccountId, lines) =>
        db.transaction((tx) =>
          applyRepricePlan(
            tx,
            lines,
            {
              actorId: 'system',
              sellerAccountId,
              reason: 'Catalogue-wide alignment to the current market rules.',
              source: 'reprice-sweep',
            },
            appendAuditEvent,
          ),
        ),
    });

    if (apply && result.totals.written > 0) {
      /*
        Announced only after the pages committed. Expiring the buyer-facing
        cache for writes that could still roll back would publish a state that
        never existed — the ordering `publish-actions.ts` records.
      */
      const [{ updateTag }, { STOREFRONT_CATALOG_TAG }] = await Promise.all([
        import('next/cache'),
        import('@/lib/storefront/catalog-tag'),
      ]);

      updateTag(STOREFRONT_CATALOG_TAG);
    }

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] reprice sweep failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'sweep-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}

/** Plans and counts. Writes nothing. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return sweep(request, false);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return sweep(request, true);
}
