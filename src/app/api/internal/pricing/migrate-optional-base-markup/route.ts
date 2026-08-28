import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/pricing/migrate-optional-base-markup — one-time DDL making
 * `pricing_store_defaults.target_margin_rate` nullable.
 *
 * Same break-glass pattern as `/api/internal/pricing/migrate-opex-floor`: a
 * manual `workflow_dispatch` from GitHub's own UI, `CRON_SECRET`-authenticated,
 * no Vercel dashboard access or raw production `DATABASE_URL` ever required on a
 * laptop. It exists for the same reason that one does — `npm run db:migrate` is
 * only ever safe against a local database, `scripts/guard-remote-db.mts` refuses
 * anything else by design, and there is intentionally no local CLI path to
 * production DDL.
 *
 * **Run this before the deployment that stops writing the column.** Unlike the
 * migrations that add a column, running late here is merely useless rather than
 * destructive: widening what a column accepts cannot break code that still
 * always writes a value. It is the deployment arriving first that breaks
 * things, by omitting a field the database still demands.
 *
 * Idempotent — see `migrateOptionalBaseMarkup`. Safe to call more than once.
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
 * GET — read-only. Reports whether the column still refuses nulls, without
 * writing anything, so the state can be confirmed before and after a run rather
 * than inferred from a green workflow. Same `CRON_SECRET` gate as the POST: this
 * reveals schema shape, which is not public.
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
    const { baseMarkupIsRequired } =
      await import('@/modules/pricing/migrate-optional-base-markup');

    return NextResponse.json(
      { ok: true, baseMarkupIsRequired: await baseMarkupIsRequired(getDb()) },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] optional-base-markup status check failed', {
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
    const { migrateOptionalBaseMarkup } =
      await import('@/modules/pricing/migrate-optional-base-markup');
    const result = await migrateOptionalBaseMarkup(getDb());

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] optional-base-markup migration failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'migration-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
