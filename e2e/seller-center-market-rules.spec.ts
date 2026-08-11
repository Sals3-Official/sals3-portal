import { expect, test } from '@playwright/test';

test.describe('Seller Center market rules', () => {
  test('shows the account market setup section and the role explainer', async ({
    page,
  }) => {
    await page.goto('/market-rules');

    await expect(
      page.getByRole('heading', { name: 'Your market setup' }),
    ).toBeVisible();
    await expect(page.getByText('Owner (seller manager)')).toBeVisible();
    await expect(page.getByText('Staff (seller staff)')).toBeVisible();
  });

  test('states the platform policies separately from the account setup', async ({
    page,
  }) => {
    await page.goto('/market-rules');

    await expect(page.getByText('Global catalogue destinations')).toBeVisible();
    await expect(page.getByText('Sals3 business registration')).toBeVisible();
    await expect(page.getByText('Portal reference currency')).toBeVisible();
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
