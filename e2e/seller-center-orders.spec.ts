import { expect, test } from '@playwright/test';

test.describe('Seller Center orders', () => {
  test('a parcel the seller never handles cannot be selected', async ({
    page,
  }) => {
    await page.goto('/orders');

    // Dropship: the supplier ships it, so there is no label for this seller
    // to print and nothing to batch.
    await expect(
      page.getByRole('checkbox', { name: 'Select parcel A-88217-2' }),
    ).toBeDisabled();

    await page
      .getByRole('checkbox', { name: 'Select parcel A-88214-1' })
      .check();

    await expect(page.getByText('1 selected')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Print 1 label/ }),
    ).toBeVisible();
  });

  test('printing shows a toast with an Undo action', async ({ page }) => {
    await page.goto('/orders');

    await page
      .getByRole('checkbox', { name: 'Select parcel A-88214-1' })
      .check();
    await page.getByRole('button', { name: /Print 1 label/ }).click();

    await expect(page.getByText(/label queued/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  });

  test('a split order renders as two parcels under one reference', async ({
    page,
  }) => {
    await page.goto('/orders');

    await expect(page.getByText('Parcel 1 of 2')).toBeVisible();
    await expect(page.getByText('Parcel 2 of 2')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'A-88217', exact: true }),
    ).toHaveCount(2);
  });

  test('the shipping lane has content, not a permanent zero', async ({
    page,
  }) => {
    await page.goto('/orders?lane=shipping');

    await expect(page.getByText('1 parcel', { exact: false })).toBeVisible();
  });

  test('the completed lane has content', async ({ page }) => {
    await page.goto('/orders?lane=completed');

    await expect(page.getByText('1 parcel', { exact: false })).toBeVisible();
  });

  test('the returns lane has content', async ({ page }) => {
    await page.goto('/orders?lane=returns');

    await expect(page.getByText('1 parcel', { exact: false })).toBeVisible();
  });

  test('the channel filter narrows the list', async ({ page }) => {
    await page.goto('/orders?channel=Sals3+AU');

    await expect(page.getByText('3 parcels')).toBeVisible();
  });

  test('chips render only in the lanes that have a decision to make', async ({
    page,
  }) => {
    await page.goto('/orders');
    await expect(page.getByText('Stage', { exact: true })).toBeHidden();

    await page.goto('/orders?lane=to-process');
    await expect(page.getByText('Stage', { exact: true })).toBeVisible();

    await page.goto('/orders?lane=attention');
    await expect(page.getByText('Reason', { exact: true })).toBeVisible();

    await page.goto('/orders?lane=shipping');
    await expect(page.getByText('Stage', { exact: true })).toBeHidden();
    await expect(page.getByText('Reason', { exact: true })).toBeHidden();
  });

  test('a blocked action states its reason instead of disappearing', async ({
    page,
  }) => {
    await page.goto('/orders?lane=attention');

    await expect(
      page.getByText('Wallet balance too low to pay supplier'),
    ).toBeVisible();
    await expect(
      page.getByText('Locked while tracking is reconciled'),
    ).toBeVisible();
  });

  test('an unrecognised lane falls back to All rather than erroring', async ({
    page,
  }) => {
    await page.goto('/orders?lane=not-a-lane');

    await expect(page.getByText('9 parcels')).toBeVisible();
  });

  test('the detail view separates the two money rails', async ({ page }) => {
    await page.goto('/orders/A-88217-2');

    await expect(page.getByText('What you can do next')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Sals3 settlement' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Your supplier spend' }),
    ).toBeVisible();
    // Estimated stays estimated until adjustments resolve.
    await expect(page.getByText('Estimated seller income')).toBeVisible();
    await expect(
      page.getByText('No adjustments have been made to this order.'),
    ).toBeVisible();
  });

  test('an unknown parcel answers 404, not a 404 page under a 200', async ({
    page,
  }) => {
    // Asserted on the status, not the body. A `loading.tsx` above this route
    // puts it behind a Suspense boundary, so Next streams the shell and
    // commits a 200 before `notFound()` runs - the page then *looks* like a
    // 404 while the response says the parcel exists. That is why the list
    // skeleton lives in the `(list)` route group.
    const response = await page.goto('/orders/nope');

    expect(response?.status()).toBe(404);
  });

  test('an own-stock parcel shows no supplier spend panel', async ({
    page,
  }) => {
    await page.goto('/orders/A-88217-1');

    await expect(
      page.getByRole('heading', { name: 'Sals3 settlement' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Your supplier spend' }),
    ).toBeHidden();
  });
});
