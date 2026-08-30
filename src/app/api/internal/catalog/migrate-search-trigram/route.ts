import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/catalog/migrate-search-trigram — one-time DDL installing
 * `pg_trgm` and the two GIN trigram indexes the sourcing search needs to
 * tolerate a misspelling.
 *
 * Same break-glass pattern as `/api/internal/pricing/migrate-optional-base-markup`:
 * a manual `workflow_dispatch`, `CRON_SECRET`-authenticated, with no production
 * `DATABASE_URL` ever on a laptop.
 *
 * **Run this before the deployment that searches with `similarity()`.** Getting
 * the order wrong is not a slow search, it is a broken one: calling
 * `similarity()` without the extension raises `undefined function`. The search
 * ships with a fallback for exactly that reason, but the fallback exists for a
 * database nobody has run this against — not as licence to deploy first.
 *
 * `maxDuration` is the ceiling this route cannot exceed, and a `CONCURRENTLY`
 * build over 588,850 rows may well need longer. That is expected and handled
 * rather than avoided: an interrupted build leaves an invalid index,
 * `migrateSearchTrigram` drops an invalid index before rebuilding, and the
 * workflow calls this until the state reports ready. **A timeout here is a
 * retry, not a failure.**
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

/**
 * GET — read-only. Reports whether the extension is installed and whether each
 * index exists and is valid, so the workflow can decide it is done from the
 * database's own answer rather than from an exit code.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const refused = guard(request);

  if (refused !== null) return refused;

  try {
    // Imported lazily so an unconfigured or unreachable database cannot turn
    // this route into a build-time or cold-start failure.
    const { readSearchTrigramState } =
      await import('@/modules/catalog/candidates/migrate-search-trigram');

    return NextResponse.json(
      { ok: true, ...(await readSearchTrigramState(getDb())) },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] search-trigram status check failed', {
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
    const { migrateSearchTrigram } =
      await import('@/modules/catalog/candidates/migrate-search-trigram');

    return NextResponse.json(await migrateSearchTrigram(getDb()), {
      headers: NO_STORE,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] search-trigram migration failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'migration-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
