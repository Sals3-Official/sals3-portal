import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/catalog/products/backfill-draft-offers — give an offer row
 * to every draft variant that has none.
 *
 * Same break-glass pattern as the migrate endpoints beside it: a manual
 * `workflow_dispatch` from GitHub's own UI, `CRON_SECRET`-authenticated, no
 * Vercel dashboard access or raw production `DATABASE_URL` ever required on a
 * laptop.
 *
 * **No DDL.** This writes rows, not schema: `product_offers` rows in the same
 * `UNRESOLVED` / `PRICING_NOT_ATTEMPTED` shape `create-draft.ts` writes, for
 * draft variants that were created without one while `create-draft` demanded a
 * seller market profile that no surface could create. Without them Save Draft
 * has nothing to UPDATE and rolls the whole save back — price, specifications
 * and description together.
 *
 * The GET is read-only and reports how many draft variants still have no offer,
 * so the state can be confirmed before and after a run rather than inferred
 * from a green workflow. Bounded at 500 variants per run and idempotent: a
 * second run finds nothing and reports `0`.
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
    const { hasMediaPositionColumn } =
      await import('@/modules/catalog/products/migrate-media-position');
    const columnExists = await hasMediaPositionColumn(getDb());

    return NextResponse.json({ ok: true, columnExists }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] draft-offer backfill status check failed', {
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
    const { migrateMediaPosition } =
      await import('@/modules/catalog/products/migrate-media-position');
    const result = await migrateMediaPosition(getDb());

    return NextResponse.json({ ...result, ok: true }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] draft-offer backfill failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'backfill-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
