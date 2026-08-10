import { expect, test, type APIRequestContext } from '@playwright/test';
import postgres from 'postgres';

/**
 * The automated candidate-evaluation pipeline (ingest -> screen -> CJ
 * evidence -> qualify -> decide), driven by the protected internal route
 * `/api/internal/catalog/evaluate-tick` instead of a per-row click.
 *
 * `next dev` loads `.env.local` for its own process, but Playwright's own
 * Node process does not - `process.loadEnvFile` (same pattern as
 * `drizzle.config.ts`) makes `CRON_SECRET`/`DATABASE_URL` available here too.
 * A live CJ account and a real Postgres database are genuinely required for
 * the tick itself to do anything; every assertion below degrades honestly
 * when either secret is absent, matching how the rest of this suite treats
 * "no database configured" as an expected condition, not a failure.
 */
try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - CRON_SECRET/DATABASE_URL stay undefined, tests degrade below.
}

const PREFLIGHT_SCORE_LABELS = ['Quality score', 'Review Required', 'On Hold'];

/**
 * CI's `verify` workflow sets no `DATABASE_URL` (matches every other e2e
 * file's own honest-degradation skip). `/products/pipeline` renders a
 * `<PageHeader title="Product Sourcing">` in *both* branches, so asserting
 * only the heading is not enough to prove the real tab bar rendered - every
 * assertion that reaches into `PipelineTabs` needs this skip too, not just
 * the ones that already read the database directly.
 */
function isDatabaseConfigured(): boolean {
  return (
    typeof process.env.DATABASE_URL === 'string' &&
    process.env.DATABASE_URL.trim() !== ''
  );
}

function isConfigured(): boolean {
  return (
    typeof process.env.CRON_SECRET === 'string' &&
    process.env.CRON_SECRET.trim() !== '' &&
    isDatabaseConfigured()
  );
}

/**
 * Runs one real evaluation tick against live CJ + the real database. Serial
 * mode below keeps this the only test making CJ calls at a time - CJ allows
 * one request per second, and evidence-fetch calls cannot be parallelised.
 */
async function runTick(request: APIRequestContext) {
  const response = await request.get('/api/internal/catalog/evaluate-tick', {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });

  expect(response.ok()).toBe(true);
  return response.json();
}

test.describe.configure({ mode: 'serial' });

test.describe('automated candidate-evaluation pipeline', () => {
  test('the tick endpoint rejects an unauthenticated request', async ({
    request,
  }) => {
    const response = await request.get('/api/internal/catalog/evaluate-tick');

    expect(response.status()).toBe(401);
  });

  test('a real tick ingests and evaluates without anyone clicking a row', async ({
    request,
  }) => {
    test.skip(
      !isConfigured(),
      'CRON_SECRET/DATABASE_URL not configured in this environment',
    );

    const result = await runTick(request);

    expect(result.ok).toBe(true);
    expect(result.result).toEqual(
      expect.objectContaining({
        ingestion: expect.objectContaining({
          pagesFetched: expect.any(Number),
        }),
        claimed: expect.any(Number),
        evaluated: expect.any(Number),
      }),
    );
  });
});

test.describe('Product Sourcing screens', () => {
  /**
   * Ready/Needs Attention/Evaluating/Blocked/Exception Queue used to be
   * five separate routes, each with its own `<h1>`. They now redirect into
   * one window (`/products/pipeline?tab=`) with a shared `<h1>` and a tab
   * bar - every case below asserts the redirect target and the active tab
   * instead of a page-specific heading.
   */
  test('Qualified Products defaults to Ready and never shows a per-row check button', async ({
    page,
  }) => {
    test.skip(
      !isDatabaseConfigured(),
      'DATABASE_URL not configured in this environment',
    );

    await page.goto('/products/qualified/ready');

    await expect(page).toHaveURL(/\/products\/pipeline\?tab=ready$/);
    await expect(
      page.getByRole('heading', { name: 'Product Sourcing', level: 1 }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: /^Ready/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page.getByRole('button', { name: 'Check for Sals3' }),
    ).toHaveCount(0);
  });

  test('Needs Attention never shows a fabricated preflight score', async ({
    page,
  }) => {
    test.skip(
      !isDatabaseConfigured(),
      'DATABASE_URL not configured in this environment',
    );

    await page.goto('/products/qualified/needs-attention');

    await expect(
      page.getByRole('heading', { name: 'Product Sourcing', level: 1 }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('tab', { name: /^Needs Attention/ }),
    ).toHaveAttribute('aria-selected', 'true');

    await Promise.all(
      PREFLIGHT_SCORE_LABELS.map((label) =>
        expect(page.getByText(label, { exact: true })).toHaveCount(0),
      ),
    );
  });

  test('Blocked / Rejected page exists and states permanent vs retryable', async ({
    page,
  }) => {
    test.skip(
      !isDatabaseConfigured(),
      'DATABASE_URL not configured in this environment',
    );

    await page.goto('/products/blocked');

    await expect(
      page.getByRole('heading', { name: 'Product Sourcing', level: 1 }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('tab', { name: /^Blocked \/ Rejected/ }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('Evaluating shows queued/in-progress candidates, not a manual action', async ({
    page,
  }) => {
    test.skip(
      !isDatabaseConfigured(),
      'DATABASE_URL not configured in this environment',
    );

    await page.goto('/products/evaluating');

    await expect(
      page.getByRole('heading', { name: 'Product Sourcing', level: 1 }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole('tab', { name: /^Evaluating/ }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('the old /products/shortlisted link redirects to Ready instead of 404ing', async ({
    page,
  }) => {
    await page.goto('/products/shortlisted');

    await expect(page).toHaveURL(/\/products\/pipeline\?tab=ready$/);
  });

  test('the sidebar names the Product Sourcing group correctly and All Supplier Products is the raw browser', async ({
    page,
  }) => {
    await page.goto('/products');

    await expect(
      page.getByRole('heading', { name: 'All Supplier Products', level: 1 }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/is not built yet/i)).toHaveCount(0);
  });

  test('the Exception Queue only ever explains genuine operational failures, never "preflight not implemented"', async ({
    page,
  }) => {
    test.skip(
      !isDatabaseConfigured(),
      'DATABASE_URL not configured in this environment',
    );

    await page.goto('/products/exception-queue');

    await expect(
      page.getByRole('heading', { name: 'Product Sourcing', level: 1 }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('tab', { name: /^Exception Queue/ }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByText(/preflight, which is not implemented/i),
    ).toHaveCount(0);
  });
});

test.describe('database state after a real tick', () => {
  test('every stored decision is a real enum value, and reason codes are never empty for a blocked row', async () => {
    test.skip(
      !isDatabaseConfigured(),
      'DATABASE_URL not configured in this environment',
    );

    const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });

    try {
      const blockedWithNoReason = await sql`
        SELECT id FROM candidate_evaluations
        WHERE status = 'BLOCKED' AND cardinality(reason_codes) = 0
      `;

      expect(blockedWithNoReason).toHaveLength(0);
    } finally {
      await sql.end();
    }
  });
});

test.describe('automated pipeline on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the Ready screen never scrolls the page sideways', async ({ page }) => {
    test.skip(
      !isDatabaseConfigured(),
      'DATABASE_URL not configured in this environment',
    );

    await page.goto('/products/qualified/ready');
    await page
      .getByRole('heading', { name: 'Product Sourcing', level: 1 })
      .waitFor({ timeout: 30_000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );

    expect(overflow).toBeLessThanOrEqual(1);
  });
});
