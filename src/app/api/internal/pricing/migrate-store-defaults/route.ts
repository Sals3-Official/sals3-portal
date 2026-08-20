import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/pricing/migrate-store-defaults - one-time DDL for the
 * seller store-default pricing table (`pricing_store_defaults`). Same
 * break-glass pattern as
 * `/api/internal/catalog/products/migrate-show-supplier-photo`: a manual
 * `workflow_dispatch` from GitHub's own UI, `CRON_SECRET`-authenticated, no
 * Vercel dashboard access or raw production `DATABASE_URL` ever required on
 * a laptop.
 *
 * Exists for the same reason that one does: `npm run db:migrate` is only
 * ever safe to run against a local database
 * (`scripts/guard-remote-db.mts` refuses anything else by design). There is
 * intentionally no local CLI path to production DDL - this route, reached
 * through the deployed app's own already-correctly-configured database
 * connection, is the only sanctioned one.
 *
 * Idempotent - see `migrateStoreDefaults` and the functions it calls. Safe
 * to call more than once. This must run BEFORE any deployment whose code
 * reads the table - until it runs, the pricing resolver's store-default
 * lookup would fail with `relation "pricing_store_defaults" does not
 * exist`, which is why the feature PR is kept separate from this one.
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
 * GET - read-only. Reports whether `pricing_store_defaults` actually
 * exists, without writing anything, so the table's state can be confirmed
 * before and after a run (and at any point later) rather than inferred from
 * a green workflow. Same `CRON_SECRET` gate as the POST: this reveals
 * schema shape, which is not public information.
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
    const { hasStoreDefaultsTable } =
      await import('@/modules/pricing/migrate-store-defaults');
    const tableExists = await hasStoreDefaultsTable(getDb());

    return NextResponse.json({ ok: true, tableExists }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] store-defaults status check failed', {
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
    const { migrateStoreDefaults } =
      await import('@/modules/pricing/migrate-store-defaults');
    const result = await migrateStoreDefaults(getDb());

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] store-defaults migration failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'migration-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
