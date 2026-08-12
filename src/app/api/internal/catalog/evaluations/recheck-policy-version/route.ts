import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import isDiscoveryControlAuthorized from '@/modules/catalog/discovery/control-auth';
import recheckPolicyVersionMismatches from '@/modules/catalog/discovery/recheck-control';

/**
 * POST /api/internal/catalog/evaluations/recheck-policy-version - bounded,
 * idempotent re-evaluation of decisions taken under an obsolete policy
 * version. Returns them to `QUEUED` with admission `POLICY_VERSION_CHANGED`
 * and publishes their evaluation messages.
 *
 * Works while discovery is PAUSED, deliberately. A re-evaluation is
 * screening-only - it reads the stored `feed_snapshot` plus the resolved
 * policy and makes no CJ request - so it neither spends points nor restarts
 * broad discovery. Reaching the automatic path instead would mean resuming,
 * which does restart partitions and curated lanes. See `recheck-control.ts`.
 *
 * Shares `DISCOVERY_CONTROL_SECRET` with the discovery control routes: same
 * owner-only control plane, same server-only secret, no portal session.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({
    /**
     * Rows to re-open per connection in this call. Bounded so the owner can
     * watch one batch land before committing to a large backlog; the ceiling
     * keeps one request inside `maxDuration` and keeps the published burst
     * proportionate to what the queue drains.
     */
    limit: z.number().int().min(1).max(2000).default(500),
    supplierConnectionId: z.uuid().optional(),
  })
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
    const result = await recheckPolicyVersionMismatches({
      limit: body.limit,
      supplierConnectionId: body.supplierConnectionId,
    });

    // An undispatched intent is not a partial success: nothing else drains
    // the outbox while discovery is paused, so those rows would sit in
    // QUEUED with no message. Surface it and let the owner call again -
    // re-running is safe.
    if (result.outbox.failed > 0) {
      return NextResponse.json(
        { ok: false, reason: 'queue-publish-failed', result },
        { status: 503, headers: NO_STORE },
      );
    }

    return NextResponse.json({ ok: true, result }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] policy-version recheck failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'recheck-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
