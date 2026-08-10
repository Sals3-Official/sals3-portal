import { NextResponse, type NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import isDiscoveryControlAuthorized from '@/modules/catalog/discovery/control-auth';
import getDiscoveryStatus from '@/modules/catalog/discovery/status';

/**
 * GET /api/internal/catalog/discovery/status - truthful operational status:
 * run states, active cycle coverage counts, unresolved/failed partitions
 * with reasons, points budget, outbox depth, recent failures, and the Neon
 * storage guard. Never claims completion while any partition is unproven.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isDiscoveryControlAuthorized(request.headers.get('authorization'))) {
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
    const status = await getDiscoveryStatus();

    return NextResponse.json({ ok: true, status }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] discovery status failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'status-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
