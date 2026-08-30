import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/catalog/migrate-pipeline-order-index — the composite index
 * the sourcing pipeline's own `ORDER BY` has always needed.
 *
 * `candidate_evaluations` has no index on `updated_at`, and every pipeline tab
 * orders by it, so the Ready tab sorts 432,654 rows to return a hundred on every
 * page load. See `migrate-pipeline-order-index.ts` for the reasoning and for the
 * honest note about what has and has not been measured.
 *
 * **There is no ordering hazard with any deployment.** Nothing in the
 * application reads this index by name; it changes how an existing query is
 * planned and nothing else, so it is safe before, during and after a deploy.
 *
 * Same break-glass shape as `/api/internal/catalog/migrate-search-trigram`,
 * including the part that matters: a `CONCURRENTLY` build over half a million
 * rows can outlast `maxDuration`, an interrupted build leaves an invalid index,
 * and the next call drops it and rebuilds. **A timeout here is a retry, not a
 * failure.**
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

function guard(request: NextRequest): NextResponse | null {
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

  return null;
}

/** GET — read-only, so the workflow decides it is done from the database. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const refused = guard(request);

  if (refused !== null) return refused;

  try {
    // Imported lazily so an unconfigured or unreachable database cannot turn
    // this route into a build-time or cold-start failure.
    const { readPipelineOrderIndexState } =
      await import('@/modules/catalog/candidates/migrate-pipeline-order-index');

    return NextResponse.json(
      { ok: true, ...(await readPipelineOrderIndexState(getDb())) },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] pipeline-order-index status check failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'status-check-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const refused = guard(request);

  if (refused !== null) return refused;

  try {
    const { migratePipelineOrderIndex } =
      await import('@/modules/catalog/candidates/migrate-pipeline-order-index');

    return NextResponse.json(await migratePipelineOrderIndex(getDb()), {
      headers: NO_STORE,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] pipeline-order-index migration failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'migration-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
