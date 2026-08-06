import { expect, test } from '@playwright/test';

test.describe('Seller Center new-listing wizard', () => {
  test('opens the market-requirements stage by default with the HS code help text', async ({
    page,
  }) => {
    await page.goto('/listings/new');

    await expect(page.getByText('HS code').first()).toBeVisible();
    await expect(
      page.getByText('You need this because you ship this kind of item'),
    ).toBeVisible();
  });

  test('switching stages shows the Start fields and hides the others', async ({
    page,
  }) => {
    await page.goto('/listings/new');

    await page.getByRole('button', { name: /Start/ }).first().click();

    await expect(page.getByText('Kraft bubble mailer 32 × 25cm')).toBeVisible();
    await expect(page.getByText('HS code')).toHaveCount(1); // remaining checklist item, stage fields hidden
  });

  test('shows the completeness rail and the proceeds estimate', async ({
    page,
  }) => {
    await page.goto('/listings/new');

    await expect(page.getByText('Completeness', { exact: true })).toBeVisible();
    await expect(page.getByText('Estimated proceeds')).toBeVisible();
  });
});
