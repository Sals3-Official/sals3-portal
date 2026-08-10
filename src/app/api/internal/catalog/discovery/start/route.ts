import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import isDiscoveryControlAuthorized from '@/modules/catalog/discovery/control-auth';
import applyDiscoveryControl from '@/modules/catalog/discovery/control';

/**
 * POST /api/internal/catalog/discovery/start - owner-authorized, idempotent
 * Start. A successful initial start creates the durable queue chain; from
 * then on Vercel's managed queue continues while the owner's browser and PC
 * are closed. Repeated calls (and concurrent calls) converge on the same
 * single active chain - the database's partial unique index arbitrates.
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
      action: 'START',
      supplierConnectionId: body.supplierConnectionId,
    });

    // A failed kick-off publish has no queue delivery behind it to
    // redeliver-and-drain later - the chain would silently never start.
    // Surface it; Start is idempotent, so the owner simply retries.
    if (results.some((result) => !result.chainDispatched)) {
      return NextResponse.json(
        { ok: false, reason: 'queue-publish-failed', results },
        { status: 503, headers: NO_STORE },
      );
    }

    return NextResponse.json({ ok: true, results }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] discovery start failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'control-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
