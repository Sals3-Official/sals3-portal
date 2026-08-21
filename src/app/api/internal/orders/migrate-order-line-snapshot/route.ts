import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/orders/migrate-order-line-snapshot — one-time DDL for the
 * per-order listing snapshot (`sals3_order_lines.listing_snapshot`).
 *
 * Same break-glass pattern as
 * `/api/internal/catalog/products/migrate-show-supplier-photo`: a manual
 * `workflow_dispatch` from GitHub's own UI, `CRON_SECRET`-authenticated, no
 * Vercel dashboard access or raw production `DATABASE_URL` ever required on a
 * laptop. It exists for the same reason that one does — `npm run db:migrate` is
 * only ever safe against a local database, `scripts/guard-remote-db.mts`
 * refuses anything else by design, and there is intentionally no local CLI path
 * to production DDL.
 *
 * **This must run before the deployment that captures snapshots.** Nothing in
 * this change reads or writes the column; the capture code is a separate change
 * that follows only once a run here has reported `columnExistsAfter: true`.
 * `sals3_order_lines` is the order table, so a deployment that inserts or
 * selects a column the database does not have takes down paid checkout, not a
 * catalogue page.
 *
 * Idempotent — see `migrateOrderLineSnapshot`. Safe to call more than once.
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
 * GET — read-only. Reports whether the column actually exists, without writing
 * anything, so its state can be confirmed before and after a run rather than
 * inferred from a green workflow. Same `CRON_SECRET` gate as the POST: this
 * reveals schema shape, which is not public information.
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
    const { hasListingSnapshotColumn } =
      await import('@/modules/orders/migrate-order-line-snapshot');
    const columnExists = await hasListingSnapshotColumn(getDb());

    return NextResponse.json({ ok: true, columnExists }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] order-line-snapshot status check failed', {
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
    const { migrateOrderLineSnapshot } =
      await import('@/modules/orders/migrate-order-line-snapshot');
    const result = await migrateOrderLineSnapshot(getDb());

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] order-line-snapshot migration failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'migration-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
