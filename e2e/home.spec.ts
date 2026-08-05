import { expect, test } from '@playwright/test';

test('home page shows hello world', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Hello world' }),
  ).toBeVisible();
});
