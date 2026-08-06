import { expect, test } from '@playwright/test';

test.describe('Seller Center orders', () => {
  test('locked rows cannot be selected, and selecting a row shows the bulk bar', async ({
    page,
  }) => {
    await page.goto('/orders?orderFilter=all');

    const lockedCheckbox = page.getByRole('checkbox', {
      name: 'Select order A-88216',
    });

    await expect(lockedCheckbox).toBeDisabled();

    await page.getByRole('checkbox', { name: 'Select order A-88214' }).check();

    await expect(page.getByText('1 selected')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Print 1 label/ }),
    ).toBeVisible();
  });

  test('printing shows a toast with an Undo action', async ({ page }) => {
    await page.goto('/orders?orderFilter=all');

    await page.getByRole('checkbox', { name: 'Select order A-88214' }).check();
    await page.getByRole('button', { name: /Print 1 label/ }).click();

    await expect(page.getByText(/label queued/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  });
});
