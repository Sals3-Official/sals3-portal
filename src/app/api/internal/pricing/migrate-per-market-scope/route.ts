import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/pricing/migrate-per-market-scope — one-time DDL giving
 * merchant pricing a destination scope (`pricing_category_policies.market_code`,
 * `pricing_store_defaults.market_code`, and the four scope-aware unique
 * indexes).
 *
 * Same break-glass pattern as
 * `/api/internal/catalog/products/migrate-media-stored-copy`: a manual
 * `workflow_dispatch` from GitHub's own UI, `CRON_SECRET`-authenticated, no
 * Vercel dashboard access or raw production `DATABASE_URL` ever required on a
 * laptop. It exists for the same reason that one does — `npm run db:migrate` is
 * only ever safe against a local database, `scripts/guard-remote-db.mts` refuses
 * anything else by design, and there is intentionally no local CLI path to
 * production DDL.
 *
 * **This must run before the deployment that reads the scope.** Nothing in this
 * change names `market_code` in a Drizzle table, and that is deliberate:
 * Drizzle names every schema column in an `INSERT`, so a deployment carrying
 * the column before the database has it would break every save on the Market
 * Rules screen rather than one page. ADR-015's own
 * `Amendment — 2026-08-25` requires this ordering.
 *
 * Idempotent — see `migratePerMarketScope`. Safe to call more than once.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  if (secret === undefined || secret.trim() === '') return false;

  return request.headers.get('authorization') === `Bearer ${secret}`;
}

/**
 * GET — read-only. Reports whether the columns and the indexes actually exist,
 * without writing anything, so the state can be confirmed before and after a run
 * rather than inferred from a green workflow. Same `CRON_SECRET` gate as the
 * POST: this reveals schema shape, which is not public information.
 *
 * Columns and indexes are reported separately on purpose. A missing column
 * breaks every write immediately and loudly; a missing index breaks nothing
 * until two rows collide, and by then the resolver has already had two
 * candidates and picked one arbitrarily. A single flag would have called that
 * success.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, reason: 'unauthorized' },
      { status: 401, headers: NO_STORE },
    );
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, reason: 'no-database-configured' },
      { status: 503, headers: NO_STORE },
    );
  }

  try {
    // Imported lazily so an unconfigured or unreachable database cannot turn
    // this route into a build-time or cold-start failure.
    const { hasPerMarketScopeColumns, hasPerMarketScopeIndexes } =
      await import('@/modules/pricing/migrate-per-market-scope');
    const db = getDb();
    const [columnsExist, indexesExist] = await Promise.all([
      hasPerMarketScopeColumns(db),
      hasPerMarketScopeIndexes(db),
    ]);

    return NextResponse.json(
      { ok: true, columnsExist, indexesExist },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] per-market-scope status check failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'status-check-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, reason: 'unauthorized' },
      { status: 401, headers: NO_STORE },
    );
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, reason: 'no-database-configured' },
      { status: 503, headers: NO_STORE },
    );
  }

  try {
    const { migratePerMarketScope } =
      await import('@/modules/pricing/migrate-per-market-scope');
    const result = await migratePerMarketScope(getDb());

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] per-market-scope migration failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'migration-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
