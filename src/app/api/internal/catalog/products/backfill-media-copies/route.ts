import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/catalog/products/backfill-media-copies — takes a durable
 * Sals3 copy of the supplier photos on already-published products.
 *
 * The sweeper behind ADR-007's `Media locking` promise. Publication mirrors from
 * now on; every product published before that still points at CJ's CDN, and
 * those are the products a buyer can order today. Bounded per run
 * (`BACKFILL_PRODUCT_BATCH`), oldest published first, and the response reports
 * `remaining` so it is obvious whether to press again.
 *
 * `CRON_SECRET`-authenticated and `workflow_dispatch`-only, same break-glass
 * pattern as the migrations. It is not on a schedule: the set only shrinks, and a
 * one-off bandwidth spend belongs under a human's control (ADR-013 §12).
 *
 * **No CJ API call and no points** (ADR-017) — this reads CJ's CDN, not its API.
 * Safe to run more than once: a row that already has a copy is not selected.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

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

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, reason: 'no-database-configured' },
      { status: 503, headers: NO_STORE },
    );
  }

  try {
    // Lazily imported: the module reaches sharp and the S3 client, and an
    // unconfigured environment must not turn that into a cold-start failure.
    const { default: backfillSupplierMediaCopies } =
      await import('@/modules/catalog/products/backfill-supplier-media-copies');
    const result = await backfillSupplierMediaCopies({ db: getDb() });

    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] supplier media backfill failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'backfill-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
