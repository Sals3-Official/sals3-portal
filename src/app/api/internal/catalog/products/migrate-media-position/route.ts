import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/catalog/products/migrate-media-position — one-time DDL for
 * the seller's own gallery arrangement (`product_media_sources.position`), which
 * is also which photo is the cover: the cover is position 0.
 *
 * Same break-glass pattern as
 * `/api/internal/catalog/products/migrate-media-stored-copy`: a manual
 * `workflow_dispatch` from GitHub's own UI, `CRON_SECRET`-authenticated, no
 * Vercel dashboard access or raw production `DATABASE_URL` ever required on a
 * laptop. It exists for the same reason that one does — `npm run db:migrate` is
 * only ever safe against a local database, `scripts/guard-remote-db.mts`
 * refuses anything else by design, and there is intentionally no local CLI path
 * to production DDL.
 *
 * **This must run before the deployment that lets a seller arrange photos.**
 * `product_media_sources` is written by draft creation, by publication, and by
 * every seller upload, and Drizzle names every column of the schema in an
 * `INSERT` — so a deployment naming a column the database does not have breaks
 * importing and publishing rather than one page. Confirm with the `GET` below,
 * or with `columnExistsAfter: true` in this route's own response, before
 * deploying the feature.
 *
 * Idempotent — see `migrateMediaPosition`. Safe to call more than once.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  if (secret === undefined || secret.trim() === '') return false;

  return request.headers.get('authorization') === `Bearer ${secret}`;
}

/**
 * GET — read-only. Reports whether the column actually exists, without writing
 * anything, so its state can be confirmed before and after a run rather than
 * inferred from a green workflow. Same `CRON_SECRET` gate as the POST: this
 * reveals schema shape, which is not public information.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
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
    // Imported lazily so an unconfigured or unreachable database cannot turn
    // this route into a build-time or cold-start failure.
    const { hasMediaPositionColumn } =
      await import('@/modules/catalog/products/migrate-media-position');
    const columnExists = await hasMediaPositionColumn(getDb());

    return NextResponse.json({ ok: true, columnExists }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] media-position status check failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'status-check-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
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
    const { migrateMediaPosition } =
      await import('@/modules/catalog/products/migrate-media-position');
    const result = await migrateMediaPosition(getDb());

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] media-position migration failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'migration-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
