import { expect, test } from '@playwright/test';

test.describe('Seller Center market rules', () => {
  test('shows the role explainer', async ({ page }) => {
    await page.goto('/market-rules');

    await expect(page.getByText('Owner (seller manager)')).toBeVisible();
    await expect(page.getByText('Staff (seller staff)')).toBeVisible();
  });

  /**
   * Market setup left this page by owner decision on 2026-08-20 — a different
   * business model is coming for destination setup, and ADR-014 puts market
   * governance in the Admin Portal rather than a tenant screen. Asserted as an
   * absence so re-mounting it is a deliberate act with a failing test to
   * answer for, not a quiet re-appearance.
   */
  test('no longer carries market setup or the platform policy panel', async ({
    page,
  }) => {
    await page.goto('/market-rules');

    await expect(
      page.getByRole('heading', { name: 'Your market setup' }),
    ).toHaveCount(0);
    await expect(page.getByText('Global catalogue destinations')).toHaveCount(
      0,
    );
    await expect(page.getByText('Sals3 business registration')).toHaveCount(0);
    await expect(page.getByText('Set up a destination')).toHaveCount(0);
  });

  test('never presents the illustrative PH/ID/SG fixture as real configuration', async ({
    page,
  }) => {
    await page.goto('/market-rules');

    // Values that only exist in `lib/seller-center/market-config.ts`.
    const fixtureValues = [
      'J&T Express',
      'GCash wallet',
      'JNE Reguler',
      'Ninja Van',
      'DBS current account',
      'withholding tax',
    ];

    await Promise.all(
      fixtureValues.map((value) =>
        expect(page.getByText(value)).toHaveCount(0),
      ),
    );
  });
});
