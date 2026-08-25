import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/catalog/products/backfill-variant-dimensions — fills in
 * the packed box dimensions of variants imported while the draft path was
 * writing `null` for all three.
 *
 * Same break-glass pattern as
 * `/api/internal/catalog/products/backfill-media-copies`, and for the same
 * reason: `scripts/guard-remote-db.mts` refuses to point a local command at
 * anything but a local database, so the deployed app's own connection is the
 * only sanctioned path to production data. This carries no DDL at all — the
 * three columns have existed since the table did.
 *
 * Reads only data already in the database. No CJ call, no points (ADR-017).
 *
 * Idempotent: the statement matches only variants whose three columns are
 * still null, so a second call reports `variantsFilled: 0`. See
 * `backfillVariantDimensions`.
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
    const { backfillVariantDimensions } =
      await import('@/modules/catalog/products/backfill-variant-dimensions');
    const result = await backfillVariantDimensions(getDb());

    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] variant dimension backfill failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'backfill-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
