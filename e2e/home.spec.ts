import { expect, test } from '@playwright/test';

test('home page shows the portal sign-in form', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in' }),
  ).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();
});
