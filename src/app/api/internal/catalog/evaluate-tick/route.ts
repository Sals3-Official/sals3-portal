import { NextResponse, type NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import runEvaluationTick from '@/modules/catalog/candidates/run-tick';

/**
 * Protected internal endpoint that runs one automated-evaluation tick
 * (ingest -> requeue due retries -> evaluate one batch). Invoked by Vercel
 * Cron (see `vercel.json`) - Vercel Cron issues a `GET` request and, when
 * `CRON_SECRET` is set on the project, automatically adds an
 * `Authorization: Bearer <CRON_SECRET>` header, which is this route's entire
 * authorization. There is no portal session on a cron invocation, so
 * `requirePermission` does not apply here.
 *
 * Must always run fresh against the database - never a cached response.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  if (secret === undefined || secret.trim() === '') {
    // No secret configured: refuse rather than run this unauthenticated.
    return false;
  }

  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, reason: 'unauthorized' },
      { status: 401 },
    );
  }

  if (!isDatabaseConfigured()) {
    // An environment with no database is expected (preview/CI) - a no-op
    // 200 keeps Vercel Cron's health view green instead of alerting on it.
    return NextResponse.json({ ok: true, skipped: 'no-database-configured' });
  }

  try {
    const result = await runEvaluationTick();

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    // Structured server-side log only; the response carries no internal detail.
    // eslint-disable-next-line no-console
    console.error('[portal] evaluation tick failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'tick-failed' },
      { status: 500 },
    );
  }
}

export const POST = GET;
