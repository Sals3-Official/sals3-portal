import { expect, test } from '@playwright/test';

/**
 * Matches the skip condition already established in catalog-shortlist.spec.ts
 * for real-database-dependent assertions - CI's `verify` workflow sets no
 * `DATABASE_URL`, so `/overview` correctly falls into its own "No database
 * configured" branch there, which has none of this page's normal sections.
 */
function isDatabaseConfigured(): boolean {
  return (
    typeof process.env.DATABASE_URL === 'string' &&
    process.env.DATABASE_URL.trim() !== ''
  );
}

test.describe('Seller Center overview', () => {
  test('shows the real section shell and honest not-built-yet notices', async ({
    page,
  }) => {
    test.skip(
      !isDatabaseConfigured(),
      'DATABASE_URL not configured in this environment',
    );

    await page.goto('/overview');

    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    // exact: true - the page's own description text ("What needs you now,
    // and what the money looks like") would otherwise substring-match too.
    await expect(
      page.getByText('Needs you now', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Product Sourcing queues')).toBeVisible();
    await expect(page.getByText('Supplier Apps health')).toBeVisible();
    await expect(page.getByText('Recent supplier changes')).toBeVisible();

    // Money position states its two rails rather than a fabricated figure -
    // no backend exists for either yet.
    await expect(
      page.getByText('Rail A · Customer pays Sals3 → Sals3 pays you'),
    ).toBeVisible();
    await expect(
      page.getByText('Rail B · You pay the supplier, from your own account'),
    ).toBeVisible();
    await expect(
      page.getByText('Needs a payment and commission backend - not built yet.'),
    ).toBeVisible();
  });

  test('Product Sourcing queues links to the real sourcing pages', async ({
    page,
  }) => {
    test.skip(
      !isDatabaseConfigured(),
      'DATABASE_URL not configured in this environment',
    );

    await page.goto('/overview');

    // Scoped to the table - the sidebar has its own "Exception Queue" link
    // to the same href, which would otherwise match too.
    await expect(
      page.getByRole('table').getByRole('link', { name: 'Exception Queue' }),
    ).toHaveAttribute('href', '/products/exception-queue');
  });
});
