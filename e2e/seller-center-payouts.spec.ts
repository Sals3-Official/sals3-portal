import { expect, test } from '@playwright/test';

test.describe('Seller Center payouts', () => {
  test('choosing a schedule marks it selected', async ({ page }) => {
    await page.goto('/payouts');

    const monthly = page.getByRole('button', { name: /^Monthly/ });

    await monthly.click();
    await expect(monthly).toHaveAttribute('aria-pressed', 'true');
  });

  test('the destination-change dialog states the re-authentication friction', async ({
    page,
  }) => {
    await page.goto('/payouts');

    await page.getByRole('button', { name: 'Change destination' }).click();

    await expect(
      page.getByText('needs a fresh sign-in, tells the account owner'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});
