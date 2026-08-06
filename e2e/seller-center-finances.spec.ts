import { expect, test } from '@playwright/test';

test.describe('Seller Center finances', () => {
  test('the ledger lines sum to the displayed estimated total', async ({
    page,
  }) => {
    await page.goto('/finances');

    await expect(page.getByText(/itemized ledger/)).toBeVisible();
    // 4,980 + 180 + 100 - 448 - 102 - 250 - 124 = 4,336
    await expect(page.getByText('₱4,336.00')).toBeVisible();
    await expect(page.getByText('What is not in this number')).toBeVisible();
  });
});
