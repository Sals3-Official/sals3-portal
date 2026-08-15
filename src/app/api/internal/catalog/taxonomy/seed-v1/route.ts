import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import { seedSals3CategoriesV1 } from '@/modules/catalog/taxonomy/seed-v1';

/**
 * POST /api/internal/catalog/taxonomy/seed-v1 - one-time, idempotent seed of
 * the Sals3 Taxonomy v1 extraction into `sals3_categories`. See
 * `.github/workflows/taxonomy-seed-v1.yml` and
 * `taxonomy-status.yml`/`/api/internal/catalog/taxonomy/status`, which
 * found this environment at 0 real v1 rows (3 total, all cj-mirror rows) -
 * this is the fix for exactly that finding.
 *
 * Shares `CRON_SECRET` with the other break-glass routes: same owner-only
 * manual-trigger control plane, no portal session, triggered only via
 * `workflow_dispatch` from GitHub's own UI - no Vercel access or raw
 * database credential ever required.
 *
 * Additive only (`onConflictDoNothing` on the unique code) - safe to call
 * more than once. See `seedSals3CategoriesV1`'s own doc comment for why
 * this is deliberately narrower than the CLI script it mirrors.
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
    const result = await seedSals3CategoriesV1(getDb());

    return NextResponse.json({ ok: true, result }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] taxonomy v1 seed failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'seed-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
