import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import { getSals3CategoriesStatus } from '@/modules/catalog/taxonomy/v1-reference';

/**
 * GET /api/internal/catalog/taxonomy/status - read-only census of
 * `sals3_categories`, for diagnosing an environment this session has no
 * direct database access to (see `.github/workflows/taxonomy-status.yml`,
 * `workflow_dispatch`-triggered from GitHub, same break-glass pattern as
 * `evaluate-tick.yml`). Shares `CRON_SECRET` with that route - same
 * owner-only manual-trigger control plane, no portal session.
 *
 * Writes nothing. Exists specifically because "the picker's search returns
 * nothing" cannot distinguish a genuinely empty table from a table full of
 * stale rows from a different taxonomy version - this answers that without
 * guessing, before any seed/migration action is considered.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  if (secret === undefined || secret.trim() === '') return false;

  return request.headers.get('authorization') === `Bearer ${secret}`;
}

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
    const status = await getSals3CategoriesStatus(getDb());

    return NextResponse.json({ ok: true, status }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] taxonomy status check failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'status-check-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
