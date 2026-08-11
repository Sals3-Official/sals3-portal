import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import isDiscoveryControlAuthorized from '@/modules/catalog/discovery/control-auth';
import admitPilotCandidates from '@/modules/catalog/discovery/pilot-admission';

/**
 * POST /api/internal/catalog/discovery/pilot/admit - owner-authorized,
 * bounded, idempotent admission for the development pilot.
 *
 * Requeues up to `limit` explicitly-scoped candidates that have never
 * completed a paid evidence fetch, and publishes their evaluation messages.
 * Unlike the freshness sweep this does NOT require discovery to be RUNNING,
 * so the pilot can proceed with ingestion paused. It never admits more than
 * the remaining pilot allowance.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({ limit: z.number().int().min(1).max(500).optional() })
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
    const result = await admitPilotCandidates({ limit: body.limit ?? 100 });

    // A failed publish has no queue delivery behind it to redeliver-and-drain
    // later, so the admitted rows would sit QUEUED with nothing in flight.
    // Surface it; the action is idempotent, so the owner simply retries.
    if (result.failed > 0) {
      return NextResponse.json(
        { ok: false, reason: 'queue-publish-failed', result },
        { status: 503, headers: NO_STORE },
      );
    }

    return NextResponse.json({ ok: true, result }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] pilot admission failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'admission-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
