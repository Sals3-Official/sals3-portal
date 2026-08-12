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

  test('unconfigured printing explains that nothing was sent', async ({
    page,
  }) => {
    await page.goto('/orders');

    await page
      .getByRole('checkbox', { name: 'Select parcel A-88214-1' })
      .check();
    await page.getByRole('button', { name: /Print 1 label/ }).click();

    await expect(
      page.getByText('Label printing is not configured yet. Nothing was sent.'),
    ).toBeVisible();
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

  // Asserted as "has rows", not as an exact count. A lane reading zero forever
  // is the defect worth catching; pinning the number just means every fixture
  // added later breaks a test that was never about arithmetic.
  test('the shipping lane has content, not a permanent zero', async ({
    page,
  }) => {
    await page.goto('/orders?lane=shipping');

    await expect(page.getByRole('article').first()).toBeVisible();
  });

  test('the completed lane has content', async ({ page }) => {
    await page.goto('/orders?lane=completed');

    await expect(page.getByRole('article').first()).toBeVisible();
  });

  test('the returns lane has content', async ({ page }) => {
    await page.goto('/orders?lane=returns');

    await expect(page.getByRole('article').first()).toBeVisible();
  });

  test('every attention reason chip has a parcel behind it', async ({
    page,
  }) => {
    // A chip that filters to nothing reads as broken, so each reason needs at
    // least one parcel carrying it.
    await page.goto('/orders?lane=attention&reason=funding');
    await expect(page.getByRole('article').first()).toBeVisible();

    await page.goto('/orders?lane=attention&reason=supplier-failure');
    await expect(page.getByRole('article').first()).toBeVisible();

    await page.goto('/orders?lane=attention&reason=delivery-exception');
    await expect(page.getByRole('article').first()).toBeVisible();

    await page.goto('/orders?lane=attention&reason=tracking-conflict');
    await expect(page.getByRole('article').first()).toBeVisible();
  });

  test('the channel filter narrows the list', async ({ page }) => {
    // Compared against the unfiltered list rather than pinned to a number, so
    // the assertion stays about filtering and not about fixture volume.
    // `.count()` does not auto-wait, so each list is settled by waiting on its
    // first card before counting. Without that this races the render and reads
    // zero, which looks like a broken filter.
    await page.goto('/orders');
    await expect(page.getByRole('article').first()).toBeVisible();
    const all = await page.getByRole('article').count();

    await page.goto('/orders?channel=Sals3+AU');
    await expect(page.getByRole('article').first()).toBeVisible();
    const filtered = await page.getByRole('article').count();

    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(all);
  });

  test('route and stage filters are available in every lane', async ({
    page,
  }) => {
    await page.goto('/orders');
    await expect(page.getByText('Route', { exact: true })).toBeVisible();
    await expect(page.getByText('Stage', { exact: true })).toBeVisible();

    await page.goto('/orders?lane=shipping');
    await expect(page.getByText('Stage', { exact: true })).toBeVisible();
  });

  test('the reason filter appears only where a reason exists', async ({
    page,
  }) => {
    // Reason describes why a parcel needs attention, so it means nothing
    // anywhere else.
    await page.goto('/orders?lane=attention');
    await expect(page.getByText('Reason', { exact: true })).toBeVisible();

    await page.goto('/orders?lane=shipping');
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
    await page.goto('/orders');
    await expect(page.getByRole('article').first()).toBeVisible();
    const all = await page.getByRole('article').count();

    await page.goto('/orders?lane=not-a-lane');
    await expect(page.getByRole('article').first()).toBeVisible();

    expect(await page.getByRole('article').count()).toBe(all);
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

  test('Check details opens the parcel detail page', async ({ page }) => {
    // It is the most obvious control on the card. Toasting "not wired to a
    // backend" while the detail route already existed made it look broken.
    await page.goto('/orders');

    await page
      .getByRole('article')
      .first()
      .getByRole('button', { name: 'Check details' })
      .click();

    await expect(page).toHaveURL(/\/orders\/A-\d+-\d+$/);
    await expect(
      page.getByRole('heading', { name: 'Money on this parcel' }),
    ).toBeVisible();
  });

  test('the money row never shows a figure spanning two rails', async ({
    page,
  }) => {
    await page.goto('/orders/A-88217-2');

    // Settlement ₱3,063.38 minus supplier spend ₱412.00. That is the "profit"
    // number a reader wants and the architecture forbids: the two rails settle
    // with different counterparties, so the difference means nothing.
    await expect(page.getByText('₱2,651.38')).toHaveCount(0);
    // Buyer payment minus settlement, the other tempting subtraction.
    await expect(page.getByText('₱391.62')).toHaveCount(0);

    await expect(page.getByText('Buyer paid', { exact: true })).toBeVisible();
    await expect(page.getByText('Your Sals3 settlement')).toBeVisible();
    await expect(page.getByText('Your supplier spend')).toBeVisible();
  });

  test('buyer contact details are masked until revealed', async ({ page }) => {
    await page.goto('/orders/A-88217-2');

    // Off on load, every load.
    await expect(page.getByText('M****z · Makati')).toBeVisible();
    await expect(page.getByText('Maria Mendez')).toHaveCount(0);

    await page.getByRole('button', { name: 'Reveal contact details' }).click();

    await expect(page.getByText('Maria Mendez')).toBeVisible();
    await expect(page.getByText('+63 917 220 4471')).toBeVisible();

    // And it masks again on reload rather than persisting.
    await page.reload();
    await expect(page.getByText('Maria Mendez')).toHaveCount(0);
  });

  test('an own-stock parcel shows no delivery estimate it cannot source', async ({
    page,
  }) => {
    // Only a supplier gives us a window, so inventing one for a parcel we ship
    // ourselves would be a promise with nothing behind it.
    await page.goto('/orders/A-88217-1');

    await expect(page.getByText('Supplier estimate')).toHaveCount(0);

    await page.goto('/orders/A-88217-2');

    await expect(page.getByText('Supplier estimate')).toBeVisible();
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
