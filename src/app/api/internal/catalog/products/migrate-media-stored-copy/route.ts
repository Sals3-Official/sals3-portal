import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/catalog/products/migrate-media-stored-copy — one-time DDL
 * for the Sals3-hosted copy of a supplier photo
 * (`product_media_sources.stored_url` / `stored_at`).
 *
 * Same break-glass pattern as
 * `/api/internal/catalog/products/migrate-show-supplier-photo`: a manual
 * `workflow_dispatch` from GitHub's own UI, `CRON_SECRET`-authenticated, no
 * Vercel dashboard access or raw production `DATABASE_URL` ever required on a
 * laptop. It exists for the same reason that one does — `npm run db:migrate` is
 * only ever safe against a local database, `scripts/guard-remote-db.mts`
 * refuses anything else by design, and there is intentionally no local CLI path
 * to production DDL.
 *
 * **This must run before the deployment that mirrors supplier photos.** Nothing
 * in this change reads or writes the columns; the mirror code is a separate
 * change that follows only once a run here has reported
 * `columnsExistAfter: true`. `product_media_sources` is written by draft
 * creation, by publication, and by every seller upload, so a deployment naming a
 * column the database does not have breaks importing and publishing rather than
 * one page.
 *
 * Idempotent — see `migrateMediaStoredCopy`. Safe to call more than once.
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
    const { hasStoredCopyColumns } =
      await import('@/modules/catalog/products/migrate-media-stored-copy');
    const columnsExist = await hasStoredCopyColumns(getDb());

    return NextResponse.json({ ok: true, columnsExist }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] media-stored-copy status check failed', {
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
    const { migrateMediaStoredCopy } =
      await import('@/modules/catalog/products/migrate-media-stored-copy');
    const result = await migrateMediaStoredCopy(getDb());

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] media-stored-copy migration failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'migration-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
