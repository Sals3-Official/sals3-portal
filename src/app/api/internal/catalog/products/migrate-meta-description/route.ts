import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/catalog/products/migrate-meta-description - one-time
 * DDL for the Meta Description feature (`products.meta_description`). Same
 * break-glass pattern as
 * `/api/internal/catalog/taxonomy/migrate-attribute-controls`: a manual
 * `workflow_dispatch` from GitHub's own UI, `CRON_SECRET`-authenticated, no
 * Vercel dashboard access or raw production `DATABASE_URL` ever required on
 * a laptop.
 *
 * Exists for the same reason that one does: `npm run db:migrate` is only
 * ever safe to run against a local database
 * (`scripts/guard-remote-db.mts` refuses anything else by design, since a
 * production connection string pasted into `.env.local` "to run one query"
 * would otherwise let a routine write command silently alter live schema).
 * There is intentionally no local CLI path to production DDL - this route,
 * reached through the deployed app's own already-correctly-configured
 * database connection, is the only sanctioned one.
 *
 * Idempotent - see `migrateMetaDescription` and the functions it calls.
 * Safe to call more than once, including before this feature's PR is even
 * merged to `main` (the column is additive and nothing reads it yet).
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
    const { migrateMetaDescription } =
      await import('@/modules/catalog/products/migrate-meta-description');
    const result = await migrateMetaDescription(getDb());

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] meta-description migration failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'migration-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
