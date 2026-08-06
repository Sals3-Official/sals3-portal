import { expect, test } from '@playwright/test';

test.describe('Seller Center overview', () => {
  test('shows needs-action tasks and the money position', async ({ page }) => {
    await page.goto('/overview');

    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText('Needs action now')).toBeVisible();
    await expect(page.getByText('Money position')).toBeVisible();
    await expect(page.getByText('Estimated')).toBeVisible();
  });

  test('can mute and unmute growth suggestions', async ({ page }) => {
    await page.goto('/overview');

    const toggle = page.getByRole('button', { name: 'Mute 30 days' });

    await toggle.click();
    await expect(
      page.getByText('Suggestions are muted for 30 days.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unmute' })).toBeVisible();
  });
});
