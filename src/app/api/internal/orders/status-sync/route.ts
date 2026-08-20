import { NextResponse, type NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import runOrderStatusSync from '@/modules/orders/status-sync';

/**
 * POST /api/internal/orders/status-sync — one bounded status-sync batch.
 *
 * The scheduled entry point for `modules/orders/status-sync.ts`: the GitHub
 * Actions workflow `orders-status-sync.yml` calls it on a schedule, and an
 * operator can call it by hand after configuring a webhook outage. It is
 * `CRON_SECRET`-gated like the other internal routes — there is no portal
 * session on a scheduled invocation, so `requirePermission` does not apply.
 *
 * Buyer-facing reads never come here: `/api/storefront/orders*` answers from
 * the database this route maintains. Keeping the CJ calls on this side of that
 * line is what makes the buyer page's latency independent of CJ's.
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
    const result = await runOrderStatusSync();

    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[orders-status-sync] run failed', error);

    return NextResponse.json(
      { ok: false, reason: 'sync-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
