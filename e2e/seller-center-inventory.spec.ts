import { expect, test } from '@playwright/test';

test.describe('Seller Center inventory', () => {
  test('the stepper updates the sellable count and appends to the record', async ({
    page,
  }) => {
    await page.goto('/inventory');

    await expect(page.getByText('286')).toBeVisible();

    await page
      .getByRole('button', { name: 'Increase amount on hand' })
      .first()
      .click();

    await expect(page.getByText('287')).toBeVisible();
    await expect(
      page.getByText('You changed the amount on hand for Kraft mailer 32cm'),
    ).toBeVisible();
  });
});
