import { NextResponse, type NextRequest } from 'next/server';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';

/**
 * POST /api/internal/catalog/taxonomy/migrate-attribute-controls - one-time
 * DDL + seed for the category-attribute-controls feature
 * (`category_attribute_dictionary`, `category_attribute_controls`,
 * `product_category_attribute_values`). Same break-glass pattern as the
 * removed `seed-v1` endpoint: a manual `workflow_dispatch` from GitHub's own
 * UI, `CRON_SECRET`-authenticated, no Vercel access or raw database
 * credential ever required.
 *
 * This is the fix for the exact class of incident the taxonomy v1 rollout
 * already hit once (`sals3-session-2026-08-15-part48-...` in the sibling
 * vault): a migration/seed run against a local database only, never against
 * the deployed one. That time the table existed with zero rows; this time
 * the tables did not exist at all, so `/listings` (every call to
 * `listCatalogueProductsForSeller`) failed outright until this ran.
 *
 * Idempotent - see `migrateAttributeControls` and the step functions it
 * calls for the details. Safe to call more than once. Fails closed (HTTP
 * 409, nothing written) if the seed references a category code not present
 * in `sals3_categories`, rather than silently seeding a partial data set.
 *
 * The migration module (and the ~37MB seed reference data it imports) is
 * loaded via a dynamic `import()` below, after the auth and
 * database-configured checks, so an unauthorized or misconfigured-request
 * never pays that module's load cost.
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
    // Loaded only after auth + db-configured checks pass, so an
    // unauthorized or misconfigured-environment request never pays the cost
    // of importing this module's ~37MB seed reference data.
    const { migrateAttributeControls } =
      await import('@/modules/catalog/taxonomy/migrate-attribute-controls');
    const result = await migrateAttributeControls(getDb());

    if (!result.ok) {
      return NextResponse.json(result, { status: 409, headers: NO_STORE });
    }

    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] attribute-controls migration failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'migration-failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
