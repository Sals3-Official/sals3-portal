import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/orders/migrate-buyer-uid - one-time DDL for the verified
 * account id on a checkout intent and the order it becomes (`buyer_uid`), plus
 * the index the buyer order list filters on.
 *
 * Same break-glass pattern as `/api/internal/orders/migrate-shipping-tier`: a
 * manual `workflow_dispatch` from GitHub's own UI, `CRON_SECRET`-authenticated,
 * no Vercel dashboard access or raw production `DATABASE_URL` ever required on
 * a laptop. `npm run db:migrate` is only ever safe against a local database -
 * `scripts/guard-remote-db.mts` refuses anything else by design - so this route,
 * reached through the deployed app's own database connection, is the only
 * sanctioned path to production DDL.
 *
 * Idempotent; safe to call more than once. Both the checkout accept path and
 * the buyer read model reference these columns, so this must run as soon as the
 * deployment carrying them is live - otherwise checkout acceptance fails with
 * `column "buyer_uid" of relation "sals3_orders" does not exist` and every
 * buyer order read fails alongside it.
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
 * GET - read-only. Reports whether both columns actually exist, without writing
 * anything, so the schema's state can be confirmed before and after a run
 * rather than inferred from a green workflow. Same `CRON_SECRET` gate as the
 * POST: this reveals schema shape, which is not public information.
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
    const { hasBuyerUidColumns } =
      await import('@/modules/orders/migrate-buyer-uid');
    const columnsExist = await hasBuyerUidColumns(getDb());

    return NextResponse.json({ ok: true, columnsExist }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] buyer-uid status check failed', {
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
    const { migrateBuyerUid } =
      await import('@/modules/orders/migrate-buyer-uid');
    const result = await migrateBuyerUid(getDb());

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] buyer-uid migration failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'migration-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
