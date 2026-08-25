import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/pricing/migrate-opex-floor — one-time DDL adding
 * `pricing_store_defaults.min_contribution_rate` and the two constraints that
 * govern it.
 *
 * Same break-glass pattern as
 * `/api/internal/pricing/migrate-per-market-scope`: a manual
 * `workflow_dispatch` from GitHub's own UI, `CRON_SECRET`-authenticated, no
 * Vercel dashboard access or raw production `DATABASE_URL` ever required on a
 * laptop. It exists for the same reason that one does — `npm run db:migrate` is
 * only ever safe against a local database, `scripts/guard-remote-db.mts` refuses
 * anything else by design, and there is intentionally no local CLI path to
 * production DDL.
 *
 * **This must run before the deployment that reads the column.** Drizzle names
 * every column of a table in its `INSERT`, so a deployment carrying
 * `minContributionRate` before the database has it would break every store
 * default write rather than one field. Nothing in the change that adds this DDL
 * names the column, which is what makes running it early safe and running it
 * late not.
 *
 * Idempotent — see `migrateOpexFloor`. Safe to call more than once.
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
 * GET — read-only. Reports whether the column and the constraints actually
 * exist, without writing anything, so the state can be confirmed before and
 * after a run rather than inferred from a green workflow. Same `CRON_SECRET`
 * gate as the POST: this reveals schema shape, which is not public.
 *
 * Column and constraints are reported separately on purpose. A missing column
 * breaks every write immediately and loudly; a missing constraint breaks
 * nothing until a row carries both floor forms, and by then the resolver has
 * already had two answers and quietly used one.
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
    const { hasOpexFloorColumn, hasOpexFloorConstraints } =
      await import('@/modules/pricing/migrate-opex-floor');
    const db = getDb();
    const [columnExists, constraintsExist] = await Promise.all([
      hasOpexFloorColumn(db),
      hasOpexFloorConstraints(db),
    ]);

    return NextResponse.json(
      { ok: true, columnExists, constraintsExist },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] opex-floor status check failed', {
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
    const { migrateOpexFloor } =
      await import('@/modules/pricing/migrate-opex-floor');
    const result = await migrateOpexFloor(getDb());

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] opex-floor migration failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'migration-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
