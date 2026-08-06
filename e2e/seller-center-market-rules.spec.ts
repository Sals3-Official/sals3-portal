import { expect, test } from '@playwright/test';

test.describe('Seller Center market rules', () => {
  test('shows the rules table and the role explainer', async ({ page }) => {
    await page.goto('/market-rules');

    await expect(page.getByText('Commission — packaging')).toBeVisible();
    await expect(page.getByText('Carrier cutoff')).toBeVisible();
    await expect(page.getByText('Owner (seller manager)')).toBeVisible();
    await expect(page.getByText('Staff (seller staff)')).toBeVisible();
  });
});
