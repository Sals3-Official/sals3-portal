import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import isDiscoveryControlAuthorized from '@/modules/catalog/discovery/control-auth';
import applyDiscoveryControl from '@/modules/catalog/discovery/control';

/**
 * POST /api/internal/catalog/discovery/resume - idempotent resume. Sets the
 * run state back to RUNNING and re-enqueues the ensure-and-sweep operation,
 * which re-publishes work for every unleased non-terminal partition -
 * nothing that was parked while paused is lost.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({ supplierConnectionId: z.uuid().optional() })
  .strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  let body: z.infer<typeof bodySchema>;

  try {
    const raw: unknown = await request.json().catch(() => ({}));
    body = bodySchema.parse(raw);
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid-request' },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const results = await applyDiscoveryControl({
      action: 'RESUME',
      supplierConnectionId: body.supplierConnectionId,
    });

    // Same rule as Start: a failed kick-off publish means nothing will
    // drain the outbox later - report it so the owner retries (idempotent).
    if (results.some((result) => !result.chainDispatched)) {
      return NextResponse.json(
        { ok: false, reason: 'queue-publish-failed', results },
        { status: 503, headers: NO_STORE },
      );
    }

    return NextResponse.json({ ok: true, results }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] discovery resume failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'control-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
