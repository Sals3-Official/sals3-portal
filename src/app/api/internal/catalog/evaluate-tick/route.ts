import { NextResponse, type NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import { revalidateTag } from 'next/cache';
import runEvaluationTick from '@/modules/catalog/candidates/run-tick';
import { CANDIDATE_STATUS_COUNTS_TAG } from '@/modules/catalog/candidates/status-counts-cache';

/**
 * BREAK-GLASS RECOVERY ONLY. The normal execution model is the durable
 * Vercel Queues chain (started once via POST /api/internal/catalog/
 * discovery/start); this route is an authenticated manual recovery action
 * for a stalled chain - it drains the transactional outbox, requeues due
 * retries, and evaluates one bounded batch. It is NOT scheduled anywhere
 * (ADR-013 §12 forbids cron/scheduled ticks in the target runtime); only
 * the manual `workflow_dispatch` in `.github/workflows/evaluate-tick.yml`
 * or a direct authenticated call invokes it. There is no portal session on
 * such an invocation, so `requirePermission` does not apply here.
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
    // 200 keeps the scheduled workflow run green instead of alerting on it.
    return NextResponse.json({ ok: true, skipped: 'no-database-configured' });
  }

  try {
    const result = await runEvaluationTick();

    // The break-glass path evaluates a batch, so buckets moved.
    // Stale-while-revalidate, as in the queue consumer.
    revalidateTag(CANDIDATE_STATUS_COUNTS_TAG, 'max');

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
