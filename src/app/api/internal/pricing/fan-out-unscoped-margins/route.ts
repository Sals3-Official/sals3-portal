import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/pricing/fan-out-unscoped-margins — one-time data migration
 * copying each all-destinations margin into every open destination, then
 * retiring the all-destinations rule.
 *
 * Same break-glass pattern as `/api/internal/pricing/migrate-per-market-scope`:
 * a manual `workflow_dispatch` from GitHub, `CRON_SECRET`-authenticated, no
 * production `DATABASE_URL` ever on a laptop.
 *
 * **This must run before the deployment that drops the all-destinations mode
 * from the screen.** Until it does, production prices everything from unscoped
 * rows; a screen that only renders per-destination columns would show every
 * category as "Not set" while those rows quietly went on pricing live orders.
 * Migration first, feature code second — the same ordering ADR-015's
 * `Amendment — 2026-08-25` requires of the DDL.
 *
 * Idempotent — see `fanOutUnscopedMargins`. Safe to call more than once.
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

/**
 * GET — read-only, and the reason this route has two verbs.
 *
 * The size of this write is not knowable from the code: it is however many
 * categories the bulk 25% import touched, multiplied by six. Reporting the plan
 * first means the run is a decision made against a number, not a hope. Same
 * `CRON_SECRET` gate as the POST — it reveals how a seller has priced.
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
    const { planFanOutUnscopedMargins } =
      await import('@/modules/pricing/fan-out-unscoped-margins');
    const plan = await planFanOutUnscopedMargins(getDb());

    return NextResponse.json({ ok: true, ...plan }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] unscoped-margin fan-out plan failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'plan-failed' },
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
    const { fanOutUnscopedMargins } =
      await import('@/modules/pricing/fan-out-unscoped-margins');
    const result = await fanOutUnscopedMargins(getDb());

    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] unscoped-margin fan-out failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'migration-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
