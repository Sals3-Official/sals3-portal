import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/catalog/taxonomy/correct-attribute-controls — takes
 * `Neckline` and `Sleeve Style` off the four skirt-only categories and narrows
 * `Dress / Skirt Style` to values that describe a skirt.
 *
 * Exists because `seedAttributeControlsData` is additive only: it can write a
 * control row and can never remove or change one, so correcting the extract
 * fixes fresh environments and leaves every already-seeded database as it was.
 *
 * Same break-glass pattern as
 * `/api/internal/catalog/taxonomy/migrate-attribute-controls`, and no DDL:
 * these are data rows inside the `controlsVersion` already in force. See
 * `correct-attribute-controls.ts` for why this is not a version bump, and why
 * no stored seller value needs backfilling.
 *
 * Idempotent — the delete matches nothing on a second call and the update
 * rewrites the values already present.
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
    const { correctAttributeControls } =
      await import('@/modules/catalog/taxonomy/correct-attribute-controls');
    const result = await correctAttributeControls(getDb());

    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] attribute control correction failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'correction-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
