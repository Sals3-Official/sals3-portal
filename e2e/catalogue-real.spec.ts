import { expect, test } from '@playwright/test';

/**
 * The REAL `/listings` catalogue (database-backed). Deliberately exercises the
 * paths that need no data, so these hold in CI's empty-database environment:
 * the truthful banner, the honest empty state, and the 404 contract of the
 * real editor. The fixture design preview keeps its own spec at
 * `/design-preview/product-catalogue`.
 */

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - DATABASE_URL stays undefined, cases degrade below.
}

function isDatabaseConfigured(): boolean {
  return (
    typeof process.env.DATABASE_URL === 'string' &&
    process.env.DATABASE_URL.trim() !== ''
  );
}

test.describe('real Product Catalogue', () => {
  test('renders the truthful banner, never the fixture one', async ({
    page,
  }) => {
    test.skip(
      !isDatabaseConfigured(),
      'DATABASE_URL not configured in this environment',
    );

    await page.goto('/listings');
    await page
      .getByRole('heading', { name: 'Product Catalogue', level: 1 })
      .waitFor({ timeout: 30_000 });

    await expect(page.getByText(/Publishing is not built yet/)).toBeVisible();
    await expect(
      page.getByText(/UI preview using fictional listing data/),
    ).toHaveCount(0);
  });

  test('an empty catalogue points at Product Sourcing instead of an error', async ({
    page,
  }) => {
    test.skip(
      !isDatabaseConfigured(),
      'DATABASE_URL not configured in this environment',
    );

    await page.goto('/listings');
    await page
      .getByRole('heading', { name: 'Product Catalogue', level: 1 })
      .waitFor({ timeout: 30_000 });

    const rows = page.locator('tbody tr');

    test.skip(
      (await rows.count()) > 0,
      'this database already holds products - the empty state is not reachable',
    );

    await expect(page.getByText('Nothing in your catalogue yet')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Open Product Sourcing' }),
    ).toBeVisible();
  });

  test('an unknown product id is a 404, indistinguishable from foreign', async ({
    page,
  }) => {
    test.skip(
      !isDatabaseConfigured(),
      'DATABASE_URL not configured in this environment',
    );

    const response = await page.goto(
      '/listings/00000000-0000-4000-8000-000000000000',
    );

    expect(response?.status()).toBe(404);
  });

  test('a malformed product id is a 404, never a database error', async ({
    page,
  }) => {
    const response = await page.goto('/listings/not-a-uuid');

    expect(response?.status()).toBe(404);
  });
});
