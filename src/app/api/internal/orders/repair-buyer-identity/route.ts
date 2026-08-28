import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/orders/repair-buyer-identity - repoints one order's
 * contact address at the account that paid for it.
 *
 * For orders stranded before `buyer_uid` existed, where the address typed into
 * the checkout form differed from the buyer's account address and the order
 * therefore disappeared from their list. `CRON_SECRET`-gated and driven by a
 * manual `workflow_dispatch`, like every other write on this side of the app:
 * there is no session on a dispatched run, so `requirePermission` does not
 * apply, and no raw production `DATABASE_URL` is handled on a laptop.
 *
 * Takes one explicitly named order. Not idempotent in the "no-op" sense - it
 * reports `changed` so a second run is visibly a no-op rather than silently one.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z.object({
  orderNumber: z.string().trim().min(1).max(64),
  buyerEmail: z.string().trim().email().max(254),
});

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

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: 'invalid-body' },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const { default: repairBuyerIdentity } =
      await import('@/modules/orders/repair-buyer-identity');
    const result = await repairBuyerIdentity(parsed.data);

    return NextResponse.json(result, {
      status: result.ok ? 200 : 409,
      headers: NO_STORE,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] buyer identity repair failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'repair-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
