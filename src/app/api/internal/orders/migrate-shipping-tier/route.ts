import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/orders/migrate-shipping-tier - one-time DDL for the
 * shipping tier recorded on an accepted order
 * (`fulfillment_groups.shipping_tier`). Same break-glass pattern as
 * `/api/internal/catalog/products/migrate-show-supplier-photo`: a manual
 * `workflow_dispatch` from GitHub's own UI, `CRON_SECRET`-authenticated, no
 * Vercel dashboard access or raw production `DATABASE_URL` ever required on a
 * laptop.
 *
 * Exists for the same reason that one does: `npm run db:migrate` is only ever
 * safe to run against a local database (`scripts/guard-remote-db.mts` refuses
 * anything else by design, since a production connection string pasted into
 * `.env.local` "to run one query" would otherwise let a routine write command
 * silently alter live schema). There is intentionally no local CLI path to
 * production DDL - this route, reached through the deployed app's own
 * already-correctly-configured database connection, is the only sanctioned
 * one.
 *
 * Idempotent - see `migrateShippingTier` and the functions it calls. Safe to
 * call more than once. `buyer-read.ts` and the checkout order writer both
 * reference this column, so this must run as soon as the deployment carrying
 * them is live - otherwise every buyer order read fails with
 * `column fulfillment_groups.shipping_tier does not exist`.
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
 * GET - read-only. Reports whether the column and its CHECK constraint
 * actually exist, without writing anything, so the schema's state can be
 * confirmed before and after a run (and at any point later) rather than
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
    const { hasShippingTierColumn, hasShippingTierConstraint } =
      await import('@/modules/checkout/migrate-shipping-tier');
    const db = getDb();
    const columnExists = await hasShippingTierColumn(db);
    const constraintExists = await hasShippingTierConstraint(db);

    return NextResponse.json(
      { ok: true, columnExists, constraintExists },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] shipping-tier status check failed', {
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
    const { migrateShippingTier } =
      await import('@/modules/checkout/migrate-shipping-tier');
    const result = await migrateShippingTier(getDb());

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] shipping-tier migration failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'migration-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
